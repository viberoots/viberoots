## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 7

This installment completes targeted cross-language refactors identified in the latest parity review. It removes a small language‑specific leak from the shared layer, unifies importer handling in Node macros that call Nix, introduces a shared WASM stamping helper, and consolidates provider‑edge realization. Each PR ships tests and documentation in the same change. No behavior changes are intended for unchanged inputs; all changes are refactors or guardrails that preserve existing artifacts and mappings.

---

## PR‑1: Extract Go tuple label logic from `//lang:defs_common.bzl` to a Go‑local module

### Description

Move Go‑specific label logic (`append_tuple_labels`, `normalize_build_tags`) out of the shared `//lang:defs_common.bzl` into `//go/private:labels.bzl`. Update `go/defs.bzl` to import and use the new helper, keeping `defs_common` truly language‑agnostic and reducing the chance of future cross‑language drift. Behavior and labels remain identical.

### Scope & Changes

- `lang/defs_common.bzl`:
  - Remove Go‑specific helpers (`normalize_build_tags`, `append_tuple_labels`).
  - Keep purely cross‑language helpers unchanged (e.g., `stamp_labels`, `append_nixpkg_labels`, `append_patch_srcs`, importer helpers).
- `go/private/labels.bzl` (new):
  - Provide `normalize_build_tags(tags: [str]) -> [str]` and `append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)`.
- `go/defs.bzl`:
  - Replace the local wrapper `_append_tuple_labels(...)` to load and delegate to `//go/private:labels.bzl`.
  - No functional changes to CGO enablement or default toolchains.

#### Tests (in this PR)

- Label parity: for representative `nix_go_library`, `nix_go_binary`, and `nix_go_test` fixtures, `buck2 cquery --json --output-attributes=labels` shows identical labels before vs after (including `gotags:*` and `goenv:*` stamps).
- CGO invariants: presence of C‑family sources or explicit CGO deps still results in `cgo:enabled` label and `override_cgo_enabled=True`.

#### Docs (in this PR)

- Add a brief note in the build‑system design: Go‑specific tuple label logic lives in `//go/private:labels.bzl`; `//lang:defs_common.bzl` is language‑agnostic.

### Acceptance Criteria

- Go labels (`gotags:*`, `goenv:*`, `cgo:enabled`) are unchanged for representative targets.
- No downstream changes to build artifacts or provider mappings.

### Risks

- Low: pure relocation of Go‑specific logic with unchanged behavior.

### Consequence of Not Implementing

- Minor cross‑language leak remains in `defs_common`, increasing future drift risk.

### Downsides for Implementing

- Small churn across imports and tests.

### Recommendation

Implement.

---

## PR‑2: Unify importer inference in Node macros that call Nix

### Description

Standardize importer inference by replacing bespoke logic in `node_webapp` and `nix_node_cli_bin(bundle=True)` with the shared path: `ensure_single_lockfile_label(...)` + `importer_from_labels(...)`. Preserve existing `global_nix_inputs()` stamping policy and deterministic behavior. This aligns error text and edge cases across Node macros.

### Scope & Changes

- `node/defs.bzl`:
  - `node_webapp(...)`: derive the `importer` strictly via `importer_from_labels(...)` after enforcing a single `lockfile:` label (with consistent error text), then build the Nix attribute using the sanitized importer.
  - `nix_node_cli_bin(bundle=True)`: same importer derivation path as above; keep non‑bundled mode unchanged.
  - Continue to stamp `global_nix_inputs()` only for macros that shell out to Nix (unchanged policy).

#### Tests (in this PR)

- Importer inference parity: for root importer `.` and nested importers like `apps/web`, the inferred importer matches `build-tools/tools/lib/importers.ts:computeImporterLabel(...)`.
- Invalidation:
  - Changing `flake.lock` invalidates `node_webapp(...)` and bundled `nix_node_cli_bin(...)` only.
  - Touching `<importer>/patches/node/*.patch` invalidates only that importer’s Node targets.
- Error text stability: multiple or missing `lockfile:` labels emit the shared, stable error message.

#### Docs (in this PR)

- Update Node macro notes to reference `ensure_single_lockfile_label` + `importer_from_labels` as the canonical importer path (no bespoke inference).

### Acceptance Criteria

- Same importer string resolved for all supported shapes of `lockfile:<path>#<importer>`.
- Identical build artifacts for unchanged inputs; precise invalidation preserved.

### Risks

- Low: replaces ad‑hoc logic with shared helpers and stable error text.

### Consequence of Not Implementing

- Slight duplication and potential drift across Node importer‑aware macros.

### Downsides for Implementing

- Minimal refactor; test updates.

### Recommendation

Implement.

---

## PR‑3: Introduce `stamp_wasm_variant(...)` helper and adopt across languages

### Description

Add a shared `stamp_wasm_variant(kwargs, variant)` helper in `//lang:defs_common.bzl` that appends `["lang:<x>", "kind:wasm", "wasm:<variant>"]` deterministically, then update existing WASM macros to use it:

- C++: `nix_cpp_wasm_static_lib(...)` (`variant="static"`), `nix_cpp_wasm_emscripten_lib(...)` (`variant="emscripten"`).
- Go: `nix_go_tiny_wasm_lib(...)` (`variant="tinygo"`).
- Python: `nix_python_wasm_app/lib(...)` (`variant="wasi"`).

No behavior changes; labels become uniformly stamped.

### Scope & Changes

- `lang/defs_common.bzl`: add `stamp_wasm_variant(kwargs, variant)`.
- `cpp/defs.bzl`, `go/defs.bzl`, `python/defs.bzl`: replace bespoke WASM label additions with `stamp_wasm_variant(...)`.

#### Tests (in this PR)

- Label shape check: `buck2 cquery --json --output-attributes=labels` on representative WASM targets includes `["lang:*", "kind:wasm", "wasm:*"]` with identical content vs before (where applicable) and stable ordering.

#### Docs (in this PR)

- Add a short note in the design docs: use `stamp_wasm_variant(...)` for all WASM targets across languages.

### Acceptance Criteria

- WASM labels are consistent across all languages and match pre‑refactor semantics.

### Risks

- Low: label stamping centralization only.

### Consequence of Not Implementing

- Minor duplication and risk of label drift across languages.

### Downsides for Implementing

- Small macro edits; trivial tests.

### Recommendation

Implement.

---

## PR‑4: DRY provider‑edge realization with a shared helper

### Description

Consolidate repeated patterns for provider wiring into a small shared helper:
`realize_provider_edges(MODULE_PROVIDERS, name, into="deps"|"srcs", base=None)` which returns a deduped list to merge into either `deps` (most macros) or `srcs` (genrule‑based macros).
Adopt across C++, Go, Node, and Python macros. No behavior change expected.

### Scope & Changes

- `lang/defs_common.bzl`:
  - Add `realize_provider_edges(...)` returning a deterministic, deduped list of provider targets for `//<pkg>:<name>`.
- Macro adoptions:
  - C++: `nix_cpp_{library,binary,addon}` merge via `deps += realize_provider_edges(...)`.
  - Go: `nix_go_{library,binary,test}` same as above.
  - Node: `nix_node_gen` merges via `srcs += realize_provider_edges(..., into="srcs")` to reflect genrule semantics.
  - Python: merge via `deps += realize_provider_edges(...)`.

#### Tests (in this PR)

- Provider parity: `buck2 cquery "deps(<targets>)" --json` (or `--output-attributes=srcs` for Node genrules) shows identical provider edges vs before across representative fixtures.

#### Docs (in this PR)

- Macro authoring note documenting when to realize provider edges into `deps` vs `srcs` and how to use `realize_provider_edges(...)`.

### Acceptance Criteria

- No change in provider edges or invalidation behavior across sample targets.

### Risks

- Low: refactor to a shared helper with identical logic.

### Consequence of Not Implementing

- Continued duplication across macros; greater risk of drift.

### Downsides for Implementing

- Minor refactor churn; straightforward test updates.

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑1 (Go helper extraction): minimal risk; cleans the shared layer first.
2. PR‑2 (Node importer unification): standardizes importer handling in Node macros that call Nix.
3. PR‑3 (Shared WASM stamp): harmonizes labels across languages.
4. PR‑4 (DRY provider edges): consolidates provider wiring after prior refactors land.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: label parity on Go targets; CGO invariants unchanged; builds identical.
  - Backout: revert module relocation; restore helpers in `defs_common`.
- PR‑2
  - Verification: importer parity with TS helpers; precise invalidation on patches and `flake.lock`; identical artifacts.
  - Backout: restore bespoke importer logic in Node macros (no data migration).
- PR‑3
  - Verification: WASM label shapes consistent across C++/Go/Python; no artifact changes.
  - Backout: re‑inline variant labels per macro.
- PR‑4
  - Verification: provider edges identical in `deps`/`srcs`; unchanged invalidation behavior.
  - Backout: restore per‑macro edge wiring; no data migration.

---

## Summary of Expected Impact

- **Stronger modular boundaries**: Go‑specific logic exits the shared layer.
- **Consistency**: Node importer inference and WASM labeling are unified across languages.
- **Less duplication**: Provider‑edge realization is centralized.
- **No behavioral changes**: For unchanged inputs, artifacts and mappings remain stable; invalidation stays precise.
