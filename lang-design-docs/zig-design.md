## Zig as a First-class Language — Design

This document proposes adding Zig as a first-class language in a way that aligns with our methodology and mirrors the established patterns for other languages (notably Go and Node). The integration follows the same architectural pillars: Buck2 for orchestration and invalidation, Nix dynamic derivations for hermetic builds, zx scripts for glue, and provider wiring for fine-grained rebuilds.

### Goals

- Consistent path invariants and provider wiring (flat `patches/zig` directory; generated providers; auto-map).
- Hermetic builds using Nix on all supported systems (aarch64-darwin, aarch64-linux, x86_64-linux).
- Deterministic invalidation via per-target labels that identify Zig dependencies.
- Ergonomic patching flow via `patch-pkg zig` with idempotency and CI guardrails.
- Minimal, readable integration that reuses existing helpers and patterns.

### Linking expectations

I follow the repo-wide linking model described in `cpp-linking.md`, `wasm-linking.md`, and `linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Shared wiring and contracts (current repo)

Use the canonical helper surface from `//lang:defs_common.bzl` and `//lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `apps/*`/`libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `lang/lang_contracts.bzl` and `tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

### Scope and Completion Criteria

- Zig targets are discoverable by the planner and exported in `tools/buck/graph.json` with deterministic `module:` labels.
- Provider sync generates `third_party/providers/TARGETS.zig.auto` from `patches/zig/*.patch` (flat dir), one provider per `pkg@version`.
- `gen-auto-map.ts` maps Zig labels to provider deps, and Zig macros append these deps to targets.
- Nix templates build Zig bins/libs with patches applied and optional dev overrides, failing in CI if overrides are set.
- Tests: provider determinism, auto_map wiring, and minimal e2e wiring for a Zig example target.

---

## Architecture

- Buck2: orchestrates target graph, test impact, and label propagation.
- Exporter (`tools/buck/export-graph.ts` + Zig adapter): emits `module:<pkgId>@<version>` labels for Zig targets.
- Planner (`graph-generator.nix`): detects Zig targets and dispatches to Zig Nix templates (`zigApp`/`zigLib`).
- Nix templates (`tools/nix/templates/zig.nix`, re-exported via `tools/nix/lang-templates.nix`): build Zig projects hermetically; scan `patches/zig` to map `pkg@ver → [patch files]`; apply `NIX_ZIG_DEV_OVERRIDE_JSON` locally (warn) and fail in CI.
- Providers: `third_party/providers/defs_zig.bzl` + generated `TARGETS.zig.auto`.
- Auto-map (`tools/buck/gen-auto-map.ts`): maps `module:` labels to provider names; no code changes needed (existing module label path reused).
- Macros (`zig/defs.bzl`): stamp `lang:zig` labels, `kind:*` labels, and append providers from `//lang:auto_map.bzl`.
- Patching CLI (`tools/patch/patch-zig.ts` delegated by `patch-pkg`): implements start/reset/apply/session with idempotency and glue steps.

### Path Invariants

- `patches/zig/` is a flat directory (no subdirectories).
- Filename format: `<pkgId>@<version>.patch`
  - `pkgId` uses PNPM-like encoding for consistency: `/` → `__` in filenames; decoding reverses this.
  - Examples: `github.com__ziglibs__zlm@v1.2.3.patch`, `std@0.12.0-dev.4012+hash.patch`.

---

## Labels and Provider Wiring

- Label format (reused, language-agnostic): `module:<pkgId>@<version>`
  - We intentionally reuse the `module:` label convention so `gen-auto-map.ts` and provider naming helpers work without change.
- Provider names are generated via existing `tools/lib/providers.ts` helpers (same as Go): `providerNameForModuleKey(pkgId, version)` → `//third_party/providers:mod_<hash>_<tail>`.
- Auto-map: Existing logic in `tools/buck/gen-auto-map.ts` already maps `module:` labels to provider names and emits `MODULE_PROVIDERS` keyed by `//pkg:name`.

---

## Exporter (Zig Adapter)

We extend the exporter to attach `module:` labels to Zig targets deterministically.

- Source of truth for Zig dependencies: `build.zig.zon` (Zig’s package metadata) plus resolved details.
- Minimal adapter behavior:
  - Parse `build.zig.zon` to enumerate declared dependencies.
  - Compute a stable package key `pkgId` and version string `version` per dependency:
    - `pkgId`: Prefer canonical package path if present (e.g., `github.com/owner/repo`), else derive from `name` or URL host+path (lowercased); encode `/` as `__` in filenames only (labels keep `/`).
    - `version`: Prefer explicit semver; otherwise use commit-ish or URL hash if present. If only a URL + integrity hash exists, convert to a normalized opaque version `rev+hash`.
  - Attach labels `module:<pkgId>@<version>` to the specific Zig targets that transitively include those dependencies (see batch strategy below).

Batch/export strategy (mirrors Go adapter principles):

- Batch Zig targets by config tuple relevant to dependency resolution. For Zig we start minimal:
  - `(zigVersion, targetTriple, buildMode, sanitized -D flags)`
  - Future: refine if Zig exposes platform/feature flags affecting resolution.
- Within a batch, compute the union dependency graph once:
  - For each Zig root package in the batch, parse `build.zig.zon` and (if present) a generated lock file (see Nix/vendor flow below).
  - Build a package→module index and annotate only the targets that reach each module.

Validation (adapter-level):

- Warn if a Zig target has Zig sources but lacks `lang:zig` label.
- Warn if `build.zig.zon` is missing or malformed for a labeled Zig target.
- CI continues to treat exporter validation as errors unless `--validation=warn` is set and `CI!=true`.

Assumption to validate: Zig exposes enough metadata (via `build.zig.zon` or a stable lock format) to produce deterministic `pkg@version` pairs without executing networked resolution during export.

---

## Planner Integration (graph-generator.nix)

We add Zig detection and dispatch in the planner (mirrors Go):

- Detect Zig targets via either:
  - `rule_type` with prefix `zig_` (e.g., `zig_binary`, `zig_library`, `zig_test`), or
  - stamped `labels` containing `lang:zig`.
- `kind`: `bin` for binaries/tests; `lib` for libraries.
- `modulesFileFor(name)`: path to the Zig metadata, typically `./build.zig.zon` relative to the target package.
- Templates: `T.zigApp { name, modulesZon, subdir ? ".", patchDir ? ../../patches/zig, devOverrideEnv ? "NIX_ZIG_DEV_OVERRIDE_JSON" }` and `T.zigLib { … }`.
- Expose `zigTargets` and include them in the aggregated `all` output just like `goTargets`.

Optional mapping support via `tools/nix/mapping.nix`:

- Allow custom aliases (`zig_service`, `my_zig_lib`) mapped to `{ template = "zig"; kind = "bin"|"lib" }`.

---

## Nix Templates (`tools/nix/templates/zig.nix`)

We implement minimal, readable templates that align with the Go pattern and reuse the same patch/override conventions.

- Build tool: use `pkgs.buildZigPackage` (preferred) or a thin wrapper around `zig build` if needed.
- Inputs:
  - `name`: logical name corresponding to the Buck target.
  - `modulesZon`: path to `build.zig.zon` in the project.
  - `subdir`: Zig project subdir (default `.`).
  - `patchDir`: default `../../patches/zig`.
  - `devOverrideEnv`: `NIX_ZIG_DEV_OVERRIDE_JSON`.
- Patch map and dev overrides:
  - Build a map `{ "pkgId@version" = [ /abs/patch1.patch ... ] }` by scanning `patchDir` (flat) at evaluation time. Same directory-scanning approach as Go.
  - Parse `builtins.getEnv devOverrideEnv` as JSON mapping `{ "pkgId@version": "/abs/local/path" }`.
  - CI guard: if `CI == true` and `devOverrideEnv` present, `builtins.throw`.
- Apply patches and overrides:
  - Vendor dependencies using Zig’s mechanisms (e.g., `build.zig.zon` + vendor dir). Overlay patches per `pkg@ver` on top of the vendored sources during the derivation.
  - If a dev override is present for a `pkg@ver`, replace that vendored source with the provided local path.
- Outputs:
  - For `zigApp`: build the default executable(s) (`zig build -Drelease-safe` or configured mode) and expose them as derivation outputs.
  - For `zigLib`: build archive/static lib if applicable or compile-only check as a conservative baseline (configurable).

Note: If `buildZigPackage` lacks built-in vendor/patch hooks, we implement a small layer to materialize a vendor tree from `build.zig.zon`, apply patches, and point the build to that vendor directory.

---

## Buck Macros (`zig/defs.bzl`)

Thin macros mirroring Go’s approach:

- `nix_zig_library(name, **kwargs)`
- `nix_zig_binary(name, **kwargs)`
- `nix_zig_test(name, **kwargs)`

Behavior:

- Stamp `lang:zig` and `kind:lib|bin|test` labels.
- Append providers from `//lang:auto_map.bzl` by reading `MODULE_PROVIDERS["//pkg:name"]`.
- Underlying rule can be a `genrule`-based shell to copy Nix-built artifacts into Buck outputs, or a future `zig_*` rule if available. The initial version may rely on `genrule` for artifact exposure while validation/invalidation relies on provider wiring.

---

## Providers

### Starlark macro

- `//third_party/providers/defs_zig.bzl`:
  - `zig_package_patch(name, module_key, patch_path)` implemented as a content-addressed `genrule` stamp.
  - Note: Go does not use provider rules; its patching is package‑local and driven via `srcs` (see build-system-design.md). Zig uses provider stamps as described here.
  - Visibility public; output `<name>.stamp`.

### Generator (zx)

- `tools/buck/sync-providers-zig.ts`:
  - Scan `patches/zig/*.patch` (flat) and decode filename → `pkgId@version`.
  - Enforce one patch per `pkgId@version` and no subdirectories (warn locally, fail strictly when run in CI or strict mode).
  - Generate `third_party/providers/TARGETS.zig.auto` deterministically using `providerNameForModuleKey(pkgId, version)` from `tools/lib/providers.ts`.
  - Idempotent and stable ordering.

Integration:

- Extend `tools/buck/sync-providers.ts` orchestrator to call the Zig provider driver alongside existing languages (reuse existing pattern of providers “drivers/index”).

---

## WASM Targets

With repo-level WASM facilities in place, Zig should support building WASM outputs:

- Targets: `wasm32-wasi` and `wasm32-freestanding` via Zig’s native cross-compilation.
- Buck macros: add `nix_zig_wasm_library`/`nix_zig_wasm_binary` (or a `wasm = "wasi"|"freestanding"` attribute) that stamp `kind:wasm` and forward the target to the planner.
- Planner/templates: extend `tools/nix/templates/zig.nix` with `zigWasmLib`/`zigWasmBin` building `.wasm` artifacts; reuse patch/override maps.
- Tests: freestanding modules loaded with `WebAssembly.instantiate`; WASI with `node:wasi` to validate exports run as expected.

Initial scope: WASI first (best portability), then freestanding where practical.

---

## Patching Workflow (`patch-pkg zig`)

- `patch-pkg start zig <pkgId>`
  - Resolve current source for `<pkgId@version>` from the Nix derivation’s vendored tree.
  - Create a CoW/APFS copy on macOS (`cp -cR`) or `cp -a` elsewhere.
  - Record temp dir in `.patch-sessions.json` (reuse `tools/patch/state.ts`).
  - Honor `$PATCH_EDITOR` to open the temp dir.

- `patch-pkg apply zig <pkgId>`
  - Generate unified diff against the pristine vendored source and write to `patches/zig/<enc_pkgId>@<version>.patch`.
  - Run glue: `node tools/buck/sync-providers.ts` → `node tools/buck/gen-auto-map.ts`.
  - Remove dev override (if any) and clean up temp dir.

- `patch-pkg reset zig <pkgId>`
  - Delete temp dir and clear state.

- `patch-pkg session zig <pkgId>`
  - Long-running session; Ctrl-D → apply; Ctrl-C → reset.

Idempotency & CI guardrails mirror Go’s.

---

## Glue & CI

- Glue scripts are zx TypeScript and not committed; they run locally and in CI stages:
  1. Export Graph → `tools/buck/graph.json` (includes Zig nodes/labels).
  2. Sync Providers → writes `TARGETS.zig.auto` (and other languages).
  3. Generate auto_map → `third_party/providers/auto_map.bzl`.
  4. Pre-build guard → fail if glue missing/stale.
  5. Build & Test → Buck builds; Nix `graph-generator` may be built as an artifact check.

- `tools/dev/startup-check.ts` additions:
  - Ensure `zig` is on PATH; check minimum supported version (assumption: ≥ 0.12).
  - Print platform note similar to other languages.
  - Warn if `NIX_ZIG_DEV_OVERRIDE_JSON` is set; fail in CI.

---

## Tests

- Provider sync determinism: one test file, one test per file convention.
  - Validates duplicate detection, name stability, and idempotent output for `TARGETS.zig.auto`.
- Auto-map wiring for Zig labels:
  - Confirm `module:<pkg>@<ver>` produces the expected provider name and is attached only to targets carrying that label.
- E2E provider wiring:
  - Reuse `tools/tests/e2e-provider-wiring.ts` with `--related <pkg@ver>` for a Zig target; verify presence/absence of providers in `deps(<target>)`.
- Optional smoke: touching an unrelated `patches/zig/*.patch` does not change rule keys for unrelated Zig targets.

---

## Assumptions to Validate

- Zig version and packaging:
  - We target Zig ≥ 0.12 with `build.zig.zon` as authoritative dependency metadata.
  - `build.zig.zon` (or a generated lock mechanism) provides stable `name/url/hash/commit` sufficient to produce deterministic `pkg@version` keys.
- Nix support:
  - `pkgs.buildZigPackage` (or equivalent) is available and suitable for our usage across supported systems.
  - We can vendor dependencies deterministically during a Nix build and apply patches predictably.
- Exporter feasibility:
  - We can parse and extract Zig dependencies without network access and without executing arbitrary code; otherwise, we will generate a minimal lock index as part of the Nix derivations and consume that in the exporter (documented fallback).

---

## Risks and Mitigations

- Parser fragility for `build.zig.zon`:
  - Risk: Zon is Zig syntax, not JSON. Ad-hoc parsing can be brittle.
  - Mitigation: Prefer a minimal, well-defined subset parser; if needed, generate a normalized JSON lock during Nix builds (e.g., `zig fetch` → write lock JSON) and have the exporter consume that JSON for labeling. Keep both paths gated; CI enforces presence of the lock when needed.

- Evolving Zig package manager semantics:
  - Risk: Upstream changes to Zon or dependency semantics.
  - Mitigation: Version-gate the adapter behavior by Zig version; add zx contract tests to catch format drift; pin Zig in dev shell and CI.

- Cross-compilation and feature flags:
  - Risk: Different targets/flags may vary dependency resolution.
  - Mitigation: Include `zigVersion`, `targetTriple`, `buildMode`, and a normalized set of `-D` flags in the exporter batch key; expand if we identify divergences.

- Patching vendor layout:
  - Risk: Mapping `pkg@ver` to vendored paths in the Nix derivation may be non-trivial.
  - Mitigation: Produce an index file during Nix builds mapping `pkg@ver` → vendor path and expose it for the patch CLI to resolve sources deterministically.

- Provider granularity:
  - Risk: Coarse provider granularity could over-invalidate.
  - Mitigation: Use per-`pkg@ver` providers (fine-grained); labels applied per-target for only the transitive modules actually used.

---

## Phased Plan (bite‑sized, verifiable)

1. Baseline & Scaffolding

- Create `patches/zig/` (empty), `zig/defs.bzl`, `third_party/providers/defs_zig.bzl` (stamp macro), and `tools/nix/templates/zig.nix`.
- Wire `tools/buck/sync-providers.ts` to call `sync-providers-zig.ts` driver.
- Tests: provider sync determinism (empty vs with one patch).

2. Exporter Adapter (labels)

- Add Zig adapter to exporter: parse `build.zig.zon` for declared deps and attach `module:<pkg>@<ver>` labels to Zig targets.
- Tests: sample Zig mini-project fixture → labels match expected set; warn-only policies enforced locally; CI treats as errors.

3. Planner Dispatch

- Add Zig detection/dispatch to `graph-generator.nix`; templates `zigApp`/`zigLib` wired in `tools/nix/lang-templates.nix`.
- Expose `zigTargets` and include in `all` aggregate.
- Verify Nix instantiation works and patches/dev overrides are visible in derivations.

4. Macros & Auto-map

- Implement `nix_zig_{library,binary,test}` macros; stamp labels; append providers from `auto_map.bzl`.
- Generate `auto_map.bzl` and verify `deps()` for a Zig target includes only relevant providers.

5. Patch Flow

- Implement `tools/patch/patch-zig.ts` with start/apply/reset/session.
- On apply: provider sync + auto-map; remove overrides; clean temp.
- Tests: idempotent apply; duplicate detection; e2e provider wiring.

6. CI & Guardrails

- Update `startup-check.ts` to include Zig and override warnings.
- Ensure CI stages include Zig provider sync; prebuild guard checks glue presence.
- Optional: build `.#graph-generator` and one Zig example to exercise derivations in CI.

---

## Areas of Concern

- Lack of canonical lock file: If `build.zig.zon` is not fully resolved or requires network fetch to lock versions, we must generate and persist a lock artifact for exporter labeling and Nix vendoring (repo-local, generated, not committed).
- Integration of `buildZigPackage` with vendor patches: We may need a small custom builder to vendor deps and apply patches consistently (documented and test-covered).
- Windows (future): Current scope excludes Windows; adding later will require additional sandboxing and path semantics.

---

## Appendix: Naming & Encoding

- Filename encoding for patches: `/` → `__` (labels keep `/`).
- Provider name generation: reuse `tools/lib/providers.ts` (`providerNameForModuleKey`).
- Env for dev overrides: `NIX_ZIG_DEV_OVERRIDE_JSON` with shape `{ "pkgId@version": "/abs/path" }`.

---

## Summary

This design adds Zig with minimal bespoke logic by reusing our established patterns: `module:` labels, generated providers, auto-map wiring, Nix templates with patch/override maps, zx glue, and thin Buck macros. It keeps invalidation precise, patches reproducible, and behavior deterministic across platforms, while leaving room to refine exporter batching and vendor mechanics as Zig’s ecosystem evolves.

### Mapping and invalidation alignment with current design

- Prefer importer‑scoped lockfile labels for Zig initially (e.g., `lockfile:<path/to/build.zig.zon>#<packageDir>`). Current `gen-auto-map.ts` maps `lockfile:` labels; no changes required.
- If per‑module `module:<pkgId>@<version>` providers are adopted, extend `tools/buck/gen-auto-map.ts` to translate Zig `module:` labels to provider names; until then, treat `module:` labels as diagnostic.
- Include package‑ or importer‑local patch files in target `srcs` to ensure precise Buck invalidation; provider stamps remain metadata‑only.
