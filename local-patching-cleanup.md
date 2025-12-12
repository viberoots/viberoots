### Go/C++ Local Patching — Cleanup and Parity Plan (vs. pnpm)

This report lists the work needed to bring Go and C++ local patching up to the same level of ergonomics and determinism as our pnpm importer‑scoped flow. It focuses on developer UX, determinism, invalidation fidelity, sparse‑checkout friendliness, and removal of legacy global patch plumbing.

---

## Goals

- Align Go/C++ local patching with pnpm’s importer‑scoped experience:
  - Patches live next to the target and only invalidate the owning target and its reverse deps.
  - No repo‑wide scans or global provider plumbing needed to apply patches.
- Preserve determinism and hermetic builds across CI and local.
- Keep partial/sparse checkouts working naturally (everything needed lives under the target).

---

## Current state (summary)

- Go
  - Local patches are included in Buck `srcs` via `local_patch_dirs` and forwarded to Nix as `patchDirs` (done).
  - Go Nix template merges patches from multiple directories and applies per‑module overrides (done).
  - CGO wiring + `nixpkg:` label stamping is implemented (done).
  - Legacy global Go provider/index checks still exist in the prebuild guard (to remove).
- C++
  - Local patches are included in Buck `srcs` and forwarded as an explicit `patches` list to Nix (done).
  - C++ Nix template applies local patches to project sources deterministically (done).
  - A global overlay `tools/nix/overlays/cpp-patches.nix` still scans `patches/cpp/**` to patch nixpkgs attrs (to remove/replace).
  - Provider syncing/mapping exists for C++ nixpkgs attrs (largely to support the global overlay flow); with local patching, we should stamp `nixpkg:` labels at call sites and drop provider plumbing.
- pnpm (reference)
  - Importer‑scoped lockfile labels drive invalidation and provider stamping. Tests, bundles, and builds are hermetic; coverage is env‑gated. No global scans are required.

---

## Gaps vs. pnpm and required changes

### 1) Remove legacy global Go/C++ patch plumbing

- Remove global Go provider/index enforcement from the prebuild guard.
  - Rationale: local patching makes global Go provider/index unnecessary; diagnostics remain via exporter labels and Nix failures when patches are malformed.
- Remove the C++ global overlay scanner for `patches/cpp/**`.
  - Rationale: per‑target local patches replace global overlay patching. If patching nixpkgs is still desired, it should be explicit and local to the target or centrally configured on a case‑by‑case basis (separate from local patch flow).
- Acceptance:
  - No global `patches/go/**` or `patches/cpp/**` scans are required for builds/tests to succeed.
  - No prebuild guard errors referring to Go provider/index files.

### 2) Make C++ nixpkgs usage explicit at the call site (labels), drop provider auto‑map dependency

- Add macro arg `nixpkg_deps` to `nix_cpp_*` macros that:
  - Stamps `nixpkg:<attr>` labels (e.g., `nixpkg:pkgs.zlib`) for planner consumption.
  - Keeps `lang:cpp`/`kind:*` stamping unchanged.
- Planner reads stamped `nixpkg:` labels (already supported) to pass `nixCxxAttrs` to `cpp.nix`.
- Remove the need for provider auto‑map to back‑propagate `nixpkg:` labels.
- Acceptance:
  - Setting `nixpkg_deps = ["pkgs.zlib", "pkgs.openssl"]` at the macro produces correct include/lib flags through `cpp.nix` and deterministically links the right libs.
  - No dependency on `third_party/providers/*` for C++ builds.

### 3) Retire Go global provider generation and index

- Remove `tools/buck/providers/go.*` and any references in provider index generation.
- Keep Go exporter module labels for diagnostics; do not map them to providers.
- Acceptance:
  - Building/testing Go apps/libs that use local patching and CGO `nix_cgo_*` args succeeds without any Go provider files.

### 4) Prebuild guard updates (local‑patch aware; no global enforcement)

- Drop checks that enforce:
  - Go `TARGETS.go.auto`, `provider_index.bzl/json`.
  - Any global C++ patch overlay outputs.
- Optional: add a non‑fatal warning when targets declare `local_patch_dirs` that are empty, to help users place patches in the right path.
- Acceptance:
  - Guard fails only when glue freshness is stale (graph export, auto‑map for Node) or critical files are missing as per current Node and language‑agnostic rules. No global Go/C++ patch artifacts are required.

### 5) patch‑pkg CLI alignment for Go/C++

- Default patch‑pkg to local mode for Go/C++:
  - `patch-pkg start/apply go --target //<pkg>:name <module>` writes to `<pkg>/patches/go/<enc>@<ver>.patch`.
  - Equivalent for C++ (writes to `<pkg>/patches/cpp/...`).
  - No provider sync step for Go/C++; a normal rebuild suffices.
- Acceptance:
  - Editing/applying a patch under the target’s local directory rebuilds only that target and its reverse deps.
  - Sparse checkouts including the target directory are sufficient to build/test with patches.

### 6) Documentation and scaffolding parity

- Update docs/handbook to declare local patching as the canonical path for Go/C++.
- Ensure scaffolds create `patches/go` or `patches/cpp` under the target directory and include a commented example patch filename format.
- Acceptance:
  - New scaffolds include local patch directories by default; readme explains the flow succinctly.

### 7) Tests and coverage of local patch flows

- Add zx tests:
  - Go: put a small local patch under `patches/go`, build, and assert effect/invalidations.
  - C++: patch a local source file via `patches/cpp` and assert build uses it; validate minimal invalidation.
  - Sparse‑checkout test: only the target dir + essentials; ensure build succeeds.
- Acceptance:
  - Tests pass locally and in CI; demonstrate precise invalidation and sparse‑checkout operability.

---

## Detailed task checklist

- Go
  - [ ] Remove Go provider generation (`tools/buck/providers/go.*`) and usages in provider index.
  - [ ] Update prebuild guard to stop enforcing Go provider/index outputs.
  - [ ] Confirm exporter diagnostics remain helpful (module labels retained).
  - [ ] Add/adjust zx tests for local patch invalidation and sparse checkout.
  - [ ] Update docs/scaffolding to note local patch layout and filename conventions.

- C++
  - [ ] Add `nixpkg_deps` to `nix_cpp_*` macros and stamp `nixpkg:` labels.
  - [ ] Update planner logic (reads stamped labels; already supported).
  - [ ] Remove reliance on provider auto‑map for `nixpkg:` propagation in C++.
  - [ ] Remove or gate off `tools/nix/overlays/cpp-patches.nix` (global patch scanning).
  - [ ] Update prebuild guard to stop checking global overlay/provider artifacts.
  - [ ] Add/adjust zx tests for local patch invalidation and sparse checkout.
  - [ ] Update docs/scaffolding to include local `patches/cpp` with examples.

- Shared
  - [ ] patch‑pkg: default to local mode for Go/C++; write patches to `patches/<lang>` under the target.
  - [ ] Documentation pass: remove references to global Go/C++ patch folders as a requirement; clarify Node providers remain importer‑scoped.
  - [ ] CI: ensure stages no longer rely on global Go/C++ artifacts; keep Node glue unchanged.

---

## Acceptance criteria

- Go/C++ targets build and test successfully using only local patch directories; no global `patches/**` scans or provider files are needed.
- Modifying a local patch re‑executes only the owning target and its reverse deps.
- Sparse checkouts of a single target directory (plus shared essentials) can build with local patches.
- C++ nixpkgs usage is declared explicitly at call sites (`nixpkg_deps`) and flows to `cpp.nix` deterministically.
- patch‑pkg provides a smooth local patch workflow for Go/C++.

---

## Risks and mitigations

- Risk: Teams still relying on global C++ overlay patches for nixpkgs.
  - Mitigation: Provide a per‑target explicit path (macro arg + local overlay if absolutely needed), document migration, and keep a short‑lived compatibility warning when global dirs are detected.
- Risk: Dropping Go provider/index impacts legacy scripts.
  - Mitigation: No current users; if any surface, add a transitional warning and a migration note.
- Risk: Developer confusion about where to place patches.
  - Mitigation: Scaffolds + README examples + non‑fatal guard warnings for empty local patch dirs.

---

## Rollout plan

1. Land macro/planner/template changes (C++ `nixpkg_deps`; remove global overlay scan).
2. Remove Go provider generation/index and guard checks.
3. Update patch‑pkg for Go/C++ local mode.
4. Update docs/scaffolds; add zx tests (local invalidation + sparse‑checkout).
5. Remove remaining references to global Go/C++ patch artifacts; keep Node providers unchanged.
