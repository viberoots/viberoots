## Quad Alignment Plan — Cross-Language DRY Tightening (CPP / Go / PNPM / Python) — Part 11

This installment focuses on small, behavior‑preserving refactors to remove duplication, standardize macro surfaces, and centralize shared logic. Each PR includes tests and documentation updates alongside the change. No user‑visible behavior changes are intended; outputs should remain byte‑for‑byte identical for unchanged inputs.

---

## PR‑1: Kwarg alias merge helper + macro migrations (unify `nixpkg_deps` alias plumbing)

### Description

Introduce a small, breaking change that standardizes on a single kwarg: `nixpkg_deps`. Remove legacy alias kwargs across macros (Go: `nix_cgo_deps`, Python: `nix_native_deps`, C++: `nix_cxx_attrs`). This rips the band‑aid off and eliminates alias plumbing entirely.

### Scope & Changes

- Remove acceptance of legacy alias kwargs in macro implementations:
  - Go: delete handling for `nix_cgo_deps`; require `nixpkg_deps`.
  - Python: delete handling for `nix_native_deps`; require `nixpkg_deps`.
  - C++: delete handling for `nix_cxx_attrs`; require `nixpkg_deps`.
- Update internal calls in the repo (if any) to use `nixpkg_deps`.
- No change to emitted labels or derivation selection for callers already on `nixpkg_deps`.

### Tests (in this PR)

- Starlark macro zx tests (goldens) verifying `nixpkg_deps` paths are unchanged.
- Negative tests that attempting legacy kwargs fails with clear error text naming `nixpkg_deps` as the required kwarg.

### Docs (in this PR)

- Macro docs: document `nixpkg_deps` as the only supported kwarg across languages.
- Migration note: replace `nix_cgo_deps` / `nix_native_deps` / `nix_cxx_attrs` with `nixpkg_deps`.
- Templates & Scaffolds: update language templates and scaffolds in `tools/templates/**` to use `nixpkg_deps` exclusively. Regenerate scaffold goldens and example `TARGETS` stubs to reflect the single kwarg.

### Acceptance Criteria

- Byte‑for‑byte identical labels and deps for unchanged inputs that already used `nixpkg_deps`.
- Calls using legacy kwargs produce deterministic, actionable errors pointing to `nixpkg_deps`.

### Risks

- Intentional breaking change for callers still on legacy kwargs; mitigated by concise error messages and straightforward migration.

### Consequence of Not Implementing

- Ongoing duplication and alias plumbing; slower convergence on a single cross‑language surface.

### Downsides for Implementing

- One‑time migration for any remaining internal call sites; potential small PRs in downstream repos.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Changes are confined to `//lang` and language macro files; typical slices already include these paths.

---

## PR‑2: Go CGO wiring consolidation (DRY across lib/bin/test)

### Description

Factor repeated CGO and toolchain logic in `go/defs.bzl` into one private helper used by `nix_go_library`, `nix_go_binary`, and `nix_go_test`. Preserve current defaults and override behavior; reduce cognitive load and divergence risk.

### Scope & Changes

- Add `_configure_cgo_and_merge_deps(name, kwargs, nixpkgLike, repoDeps)`:
  - Applies toolchain defaults, dedupes and merges nixpkgs/native CGO deps and repo CGO deps.
  - Stamps `cgo:enabled` label and calls `append_nixpkg_labels(...)` when CGO deps present.
  - Enables `override_cgo_enabled` when C‑family sources or CGO deps imply it.
  - Returns merged deps to pass to the underlying `go_*` rule.
- Replace duplicated blocks in lib/bin/test with calls to the helper.
- Keep tuple label stamping, provider edge realization, and patch inclusion exactly as today.

### Tests (in this PR)

- Golden label sets for lib/bin/test before vs after refactor (identical).
- Probe: cases that imply CGO via `srcs` vs via `nixpkg_deps` vs via `repo_cgo_deps` remain identical.
- Provider wiring script confirms edges unchanged for representative targets.

### Docs (in this PR)

- Short contributor note in Go macro docs: CGO behavior centralized; how to surface CGO via nixpkgs or repo deps remains the same.

### Acceptance Criteria

- No diffs in `buck2 cquery --json` labels or deps for unchanged inputs on representative targets.
- Tests pass across typical permutations (no CGO / CGO implied by srcs / CGO via nixpkg deps).

### Risks

- Low; consolidation only. Unit differences would be caught by goldens.

### Consequence of Not Implementing

- Ongoing duplication and subtle drift risk across the three macros.

### Downsides for Implementing

- Slightly more indirection; mitigated by clear helper naming.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Single‑file macro refactor in `go/defs.bzl`; thin slices with Go macros are unaffected.

---

## PR‑3: C++ macro core extraction (`_cpp_common`) for lib/bin/addon

### Description

Extract a `_cpp_common(name, kind, kwargs)` helper to unify shared logic in `nix_cpp_library`, `nix_cpp_binary`, and `nix_cpp_node_addon` (patch inclusion, label stamping, nixpkgs alias merge, provider edges). Keep wasm macros as‑is.

### Scope & Changes

- `_cpp_common` performs:
  - Alias merge of `nixpkg_deps` into `nix_cxx_attrs` via PR‑1 helper.
  - `stamp_labels(...)` with `lang:cpp` and appropriate `kind`.
  - `include_package_local_patches(...)` and `append_nixpkg_labels(...)`.
  - `realize_provider_edges(...)` for deps.
  - Computes `out` naming via existing sanitizer and passes to `cpp_nix_build` with unchanged parameters.
- Migrate lib/bin/addon macros to delegate to `_cpp_common` with their specific output extension (`.a`, no extension, `.node` respectively).

### Tests (in this PR)

- Golden comparisons of emitted labels, deps, and `cpp_nix_build` params (including `out`) across lib/bin/addon.
- Patch invalidation probe using `package_local_patches_probe` remains identical.

### Docs (in this PR)

- Contributor note in C++ macro docs: common behavior centralized in `_cpp_common`; public macro surfaces are unchanged.

### Acceptance Criteria

- Identical rule parameters and graph edges for representative lib/bin/addon targets.

### Risks

- Low; consolidation within the same file.

### Consequence of Not Implementing

- Repeated logic across three macros increases maintenance cost and drift risk.

### Downsides for Implementing

- Minimal code motion; readability improved.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Single‑file macro refactor in `cpp/defs.bzl`; no additional dependencies in thin slices.

---

## PR‑4: Global Nix inputs stamping helper for macros that call Nix

### Description

Create a small helper to stamp global Nix inputs into `labels` when a macro assembles a Nix‑invoking `cmd`. Migrate Node macros (`node_webapp`, bundled `nix_node_cli_bin`) to use it, removing duplicate inline stamping logic. Behavior remains unchanged.

### Scope & Changes

- Add `stamp_global_nix_inputs(kwargs)` in `//lang:defs_common.bzl`:
  - Reads `global_nix_inputs()` from `//lang:global_inputs.bzl` and dedupe‑merges into `kwargs["labels"]`.
- Migrate:
  - `node/defs.bzl:node_webapp` and the bundled branch of `nix_node_cli_bin` to call `stamp_global_nix_inputs(...)`.
- Keep command assembly and timeouts unchanged; only label stamping is centralized.

### Tests (in this PR)

- Golden tests confirm identical labels for Node macros that invoke Nix (presence of `//:flake.lock` exactly as before).
- Negative probe confirms no unintended stamping for macros that do not call Nix.

### Docs (in this PR)

- Node macro docs: reference the helper as the canonical way to stamp global inputs when a macro calls Nix.

### Acceptance Criteria

- No diffs in labels on Node macros for unchanged inputs; helper adopted.

### Risks

- Very low; replaces duplicated label stamping with a helper.

### Consequence of Not Implementing

- Small duplication persists; future policy changes require multiple edits.

### Downsides for Implementing

- Minor churn in Node macro code.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Only `//lang` and `//node` macro files change; typical slices already include these paths.

---

## PR‑5: Provider index reader unification (Node/Python)

### Description

Unify the minimal provider‑index reader wrappers for Node and Python via a small generic function. This reduces boilerplate and keeps behavior identical, including sparse‑clone constraints and YAML availability fallbacks.

### Scope & Changes

- Add a generic helper (e.g., `readImporterProviderIndexEntries(...)`) in `tools/lib/provider-index.ts` or `providers/index.ts` that accepts:
  - `discoverLockfiles`, `importersForLockfile`, optional `shouldInclude` filter.
- Refactor `readNodeProviderIndexEntries()` and `readPythonProviderIndexEntries()` to delegate to the helper.
- Preserve Node’s YAML‑parser guard and Python’s importer determination logic.

### Tests (in this PR)

- Golden tests for Node and Python provider index entries remain byte‑for‑byte identical.
- Sparse‑clone probes:
  - Node: no YAML → returns empty as before.
  - Python: importer set to dirname `"."` behavior unchanged.

### Docs (in this PR)

- Provider index section: note the shared reader helper and the environment‑sensitive YAML fallback for Node, so behavior in ultra‑thin slices is expected and documented.

### Acceptance Criteria

- Identical provider index outputs and error/empty behaviors across Node and Python for unchanged inputs.

### Risks

- Low; wrapper consolidation only.

### Consequence of Not Implementing

- Small duplication remains; adding new ecosystems will repeat similar wrappers.

### Downsides for Implementing

- Minimal refactor; improved maintainability.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Helper lives in `tools/lib` or `providers/index.ts`; remains compatible with thin slices.

---

## Rollout & Sequencing

1. PR‑1 (Kwarg alias merge helper + migrations) — unlocks DRY for PR‑2/3.
2. PR‑2 (Go CGO consolidation) — reduces duplication across Go macros.
3. PR‑3 (C++ macro core extraction) — centralizes shared logic in C++ macros.
4. PR‑4 (Global Nix inputs stamping helper) — standardizes Node label stamping for Nix invocations.
5. PR‑5 (Provider index reader unification) — trims provider‑side duplication.

---

## Verification & Backout Strategy

- Each PR ships:
  - Golden zx tests asserting byte‑for‑byte identical labels / deps / generated files for unchanged inputs.
  - Targeted probes (where applicable) for edge conditions (e.g., CGO implied by srcs vs deps; YAML absent in Node).
  - Short doc updates in the relevant macro/provider sections.
- Backout: each PR is self‑contained; revert cleanly restores prior behavior since changes are consolidations without new semantics.

---

## Templates & Scaffolds — Maintenance Guidance

- Scope: When macro surfaces or provider wiring change (even behavior‑neutral refactors), update templates and scaffolds under `tools/templates/**` so newly scaffolded code matches current best practices.
- Required updates per PR in this series:
  - PR‑1: Replace legacy kwargs with `nixpkg_deps` in Go/Python/C++ templates, example `TARGETS` snippets, and any generator stubs.
  - PR‑2: If CGO examples exist, update them to mirror the consolidated Go helper; outputs remain identical.
  - PR‑3: Ensure C++ lib/bin/addon examples reflect `_cpp_common` behavior (labels, local patches, nixpkg labels).
  - PR‑4: For Node templates that call Nix from macros, ensure examples rely on a centralized global‑inputs stamping helper.
  - PR‑5: No surface change expected; validate provider‑related examples still build identically.
- Verification:
  - Regenerate scaffolded samples (if applicable) and compare against goldens; diffs should be limited to intentional text (e.g., kwarg rename).
  - Build scaffold outputs to confirm label stamping and provider edges exist as expected.
  - Keep doc snippets synchronized with `tools/templates/**` to avoid drift.

---

## Summary of Expected Impact

- **Maintainability**: Less duplication across macros and providers, lower drift risk.
- **Consistency**: Preferred `nixpkg_deps` flows through a single helper; Node global input stamping uses one helper.
- **Safety**: No functional changes; identical outputs guaranteed via goldens for unchanged inputs.
