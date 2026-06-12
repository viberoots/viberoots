## Quad Alignment Plan — Cross-Language Parity & DRY Tightening (CPP / Go / PNPM / Python) — Part 9

This installment delivers small, high‑impact refactors that harden cross‑runtime parity (TS ↔ Nix ↔ Starlark), reduce residual duplication in provider indexing, and standardize importer utilities usage. Each PR is self‑contained, preserves current behavior for unchanged inputs, and includes tests and documentation updates within the same change.

---

## PR‑1: Nix attribute normalization parity (TS ↔ Starlark) with alias map hygiene

### Description

Ensure TS (`normalizeNixAttr`) and Starlark (`normalize_nix_attr`) normalize nixpkgs attributes identically, including legacy alias resolution (e.g., `pkgs.gtest → pkgs.googletest`). Introduce a single alias source of truth rendered for both runtimes to reduce silent drift.

### Scope & Changes

- Introduce a small canonical alias manifest (`build-tools/tools/lib/nix-attr-aliases.json`).
- Generate (at dev/test time) a Starlark alias module consumed by `build-tools/lang/defs_common.bzl` (mirrors the JSON).
- Update TS to source aliases from the same JSON (migrate from current `nix-attr-aliases.ts` to eliminate drift).
- Keep normalized output strings unchanged for existing inputs.

### Tests (in this PR)

- No new tests required; existing parity test already asserts TS ↔ Starlark ↔ Nix equality for representative attrs and the `gtest → googletest` alias. Ensure it remains green after the JSON migration.

### Docs (in this PR)

- Short note in contributor docs: alias mappings live in a single JSON; both TS and Starlark are generated/read from it.

### Acceptance Criteria

- Parity test remains green on a representative alias matrix and common nixpkgs paths.
- No changes to generated provider names or labels for unchanged inputs.

### Risks

- Minimal; generation is dev/test‑time and guarded.

### Consequence of Not Implementing

- Continued risk of minor alias drift and divergent provider naming for nixpkgs attributes.

### Downsides for Implementing

- Adds a tiny generation step for Starlark aliases.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Keep a minimal inline alias fallback in both Starlark and TS for cases where the JSON or generated Starlark alias module is not present in a sparse workspace; the JSON remains the source of truth when available.
- Make the alias generator optional/no‑op when the JSON is out of slice; do not fail glue or CI if the JSON/module is missing.
- Do not introduce runtime dependencies on the generated file; restrict generation to dev/test time so core flows work in thin slices.
- Existing parity test should pass on full clones; allow a soft‑skip mode if the JSON/module is unavailable in a sparse test slice.

---

## PR‑2: Buck label normalization parity (TS ↔ Nix)

### Description

Align TS label normalization helpers (`dropConfigSuffix`, `dropCellPrefix`, `normalizeTargetLabel`) with Nix planner’s `cleanLabel`, ensuring both yield the same canonical forms used in mapping and diagnostics.

### Scope & Changes

- Add a small TS↔Nix parity test harness around normalization of representative labels, including:
  - cell prefixes (`root//`, `prelude//`),
  - trailing `(config//...)` suffixes,
  - absolute vs relative target forms.
- If a mismatch appears, minimally adjust TS helpers to match planner semantics (preferred source of truth for graph identity). No behavior change intended for existing consumers (current helpers already match in practice).

### Tests (in this PR)

- Add a zx test that compares normalized forms produced by TS and by a Nix probe exposing `cleanLabel` over the matrix above (explicit TS ↔ Nix parity harness).

### Docs (in this PR)

- Implementation note in the build design: TS label normalization mirrors the planner’s `cleanLabel` to avoid drift.

### Acceptance Criteria

- Identical normalized labels across TS and Nix for the test matrix.
- No downstream artifact or mapping changes for unchanged inputs.

### Risks

- Very low; focused on helper semantics.

### Consequence of Not Implementing

- Possible inconsistencies when correlating TS‑side diagnostics with Nix planner outputs.

### Downsides for Implementing

- Adds small probes and tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Implement the parity harness using an inline Nix expression (no repo‑local Nix imports) and a Starlark probe, so it runs in thin slices.
- Treat missing `buck2`/`nix` or absent probe targets in sparse slices as a soft‑skip for the parity test; do not affect production code paths.
- No changes to production wiring; helpers remain tiny and independent of non‑sliced files.

---

## PR‑3: Consolidate provider‑index readers behind a tiny shared adapter

### Description

Reduce duplication between `readNodeProviderIndexEntries` and `readPythonProviderIndexEntries` by introducing a small shared adapter that handles deterministic ordering, path normalization, and provider name assembly given language‑specific inputs. Preserve exact output content and ordering.

### Scope & Changes

- Add `build-tools/tools/lib/provider-index.ts` with a tiny generic helper that:
  - accepts a callback to enumerate `(provider, key)` pairs,
  - ensures deterministic ordering and string normalization,
  - returns the normalized entries.
- Update Node and Python readers to build their language‑specific `(provider, key)` lists, then pass through the shared helper (no change to entry content).
- `build-tools/tools/buck/gen-provider-index.ts` remains the orchestrator; logic unchanged beyond import paths.

### Tests (in this PR)

- Golden ordering/content test over synthetic Node and Python inputs to prove byte‑for‑byte identical results to the pre‑refactor readers.

### Docs (in this PR)

- Contributor note: prefer the shared adapter for future importer‑scoped ecosystems.

### Acceptance Criteria

- Provider index outputs (bzl + json sidecar) remain unchanged for unchanged inputs.
- Readers are shorter and share normalization/ordering logic.

### Risks

- Low; DRY extraction only.

### Consequence of Not Implementing

- Ongoing duplication in provider index readers and higher drift risk.

### Downsides for Implementing

- Minor churn to imports and wiring.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Place `build-tools/tools/lib/provider-index.ts` under the standard glue library path and ensure sparse scaffolding includes it wherever glue scripts run (e.g., update the allowlist used by minimal copies).
- Keep `gen-provider-index.ts` optional; when lockfiles/patch dirs are missing in a slice, the readers should no‑op without error (current behavior).
- Avoid introducing any repo‑wide scans outside existing glue inputs to keep execution fast and slice‑friendly.

---

## PR‑4: Graph util: single helper to classify provider‑package nodes

### Description

Avoid ad‑hoc string checks for `//third_party/providers:*` across generators by introducing `isProviderPackageNode(name: string): boolean` in a tiny TS graph‑utils module and reusing it where relevant (e.g., `gen-auto-map.ts`, provider index generation).

### Scope & Changes

- Add `build-tools/tools/lib/graph-utils.ts` with `isProviderPackageNode(...)` and label helpers that mirror existing logic.
- Replace in‑file string prefix checks in `gen-auto-map.ts` and `gen-provider-index.ts` with the shared helper (behavior identical).

### Tests (in this PR)

- zx unit test over the helper and a tiny smoke check that auto_map generation still omits provider‑package self‑mappings (behavior already covered; this only centralizes the predicate).

### Docs (in this PR)

- Brief contributor note: prefer the helper for provider‑package node classification.

### Acceptance Criteria

- No change to generated `auto_map.bzl` or index artifacts.
- Shared helper adopted in affected modules.

### Risks

- Very low; trivial DRY.

### Consequence of Not Implementing

- Minor duplication and future drift risk.

### Downsides for Implementing

- Minimal code motion.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Place `build-tools/tools/lib/graph-utils.ts` alongside other glue libs and include it in the sparse scaffolding allowlist used by glue execution.
- Keep behavior identical to the current inline predicate so that, if the helper is missing in a very thin slice, reverting to the inline check is trivial during backout.
- Do not add new runtime dependencies; the helper is pure string logic and safe in slices.

---

## Rollout & Sequencing

1. PR‑1 (Nix attr normalization parity): migrate aliases to JSON and generate Starlark module; keep parity green.
2. PR‑2 (Label normalization parity): add explicit TS↔Nix parity harness (logic likely unchanged).
3. PR‑3 (Provider‑index adapter): consolidate reader boilerplate without behavior changes.
4. PR‑4 (Graph util): centralize provider‑package detection with a tiny helper.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: existing alias parity test remains green; provider names/labels unchanged in representative runs.
  - Backout: revert to current TS map and inline Starlark alias handling.
- PR‑2
  - Verification: new label normalization parity test green; no diffs in auto_map or indices.
  - Backout: restore prior TS helpers; parity test skipped.
- PR‑3
  - Verification: golden outputs unchanged byte‑for‑byte for provider indices.
  - Backout: revert readers to pre‑adapter implementations.
- PR‑4
  - Verification: auto_map and index artifacts unchanged; helper unit test green.
  - Backout: inline the prefix check at call sites.

---

## Summary of Expected Impact

- **Parity**: TS, Nix, and Starlark agree on nix attr normalization and label normalization.
- **Maintainability**: Less duplication in provider index readers and provider‑package checks via shared helpers.
- **Consistency**: Normalization behaviors remain aligned across tooling boundaries.
- **Safety**: All changes are guarded by golden/parity tests; outputs remain stable for unchanged inputs.
