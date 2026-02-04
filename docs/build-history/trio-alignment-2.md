## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM)

This plan applies incremental PRs to strengthen cross‑language abstractions with minimal risk. It focuses on parity and DRYing obvious duplication without changing core architecture (Buck exporter adapters → Nix planner/templates for planner languages; Node via macros + providers + glue).

The PRs are small, independently reversible, and covered by targeted tests. CI continues to generate glue and enforce freshness.

## PR‑1: Move Node bundling into a planner plugin (parity with Go/CPP)

### Description

`build-tools/tools/nix/graph-generator.nix` currently contains Node CLI bundling logic inline. Extract it into a `LANGS.node` planner plugin (e.g., `build-tools/tools/nix/planner/node.nix`) so the outer planner remains a small dispatcher. No behavior change.

### Scope & Changes

- Create `build-tools/tools/nix/planner/node.nix` exposing:
  - `isTarget`, `kindOf` (detect `lang:node` + `kind:bin`), `mkApp` for CLI bundling.
- Register in `graph-generator.nix` via `LANGS` (mirroring Go/CPP discovery).
- Move the existing Node CLI mk logic (today in `graph-generator.nix`) into the plugin.
- Keep output shape identical (derivation plumbing and bin symlinks unchanged).
- Update `build-tools/docs/build-system-design.md` under “Planner languages vs macro‑only languages” to clarify:
  - Node remains macro/provider‑driven for dependency mapping and invalidation.
  - A narrowly scoped planner plugin may be used for CLI bundling as a Nix shim.
  - This does not change provider/auto_map flows or Node’s importer‑scoped provider model.

### Acceptance Criteria

- `nix build .#graph-generator` yields identical Node CLI outputs and `graph-outputs` manifest.
- Export/build/test flows remain unchanged across supported platforms.
- No diffs in `build-tools/tools/buck/graph.json`, `third_party/providers/**`, or Buck build outputs (aside from non‑functional ordering noise, if any).

### Risks

- Low: refactor-only; constrained to planner boundaries.

### Consequence of Not Implementing

- Planner keeps a one‑off Node branch; future parity and maintenance get harder.

### Downsides for Implementing

- Small code motion may cause short‑term merge friction with other planner edits.

### Recommendation

- Implement. It tightens dispatch-only scope for the planner and aligns the language model.

## PR‑2: Unify dev‑override UX in patch handlers (Go/CPP)

### Description

Go’s `patch-go.ts` writes `NIX_GO_DEV_OVERRIDE_JSON` directly; C++’s `patch-cpp.ts` prints a snippet for `NIX_CPP_DEV_OVERRIDE_JSON`. Unify UX via a tiny shared helper and consistent messages/CI guards (no behavior change to Nix templates).

### Scope & Changes

- Add `build-tools/tools/patch/dev-overrides.ts` (get/set/clear JSON map; warn locally; throw in CI if set).
- Make `patch-go.ts` use the helper for reads/writes; keep current behavior semantics.
- Make `patch-cpp.ts` use the helper (support both echo‑snippet and in‑process set as a flag; default to in‑process set for parity).
- Keep `build-tools/tools/nix/dev-overrides.nix` unchanged (source of truth inside Nix).

### Acceptance Criteria

- Start/Apply/Reset flows produce consistent warnings, identical CI prohibition semantics, and clean session teardown across Go/CPP.
- Tests for both languages confirm override round‑trips and CI failure behavior.

### Risks

- Low: small refactor and UX alignment; Nix behavior unchanged.

### Consequence of Not Implementing

- Ongoing UX divergence and duplicated ad‑hoc env handling in patch handlers.

### Downsides for Implementing

- Slight coupling on a new shared patch helper (well-contained).

### Recommendation

- Implement. Improves ergonomics and reduces drift.

## PR‑3: DRY exporter validation for unlabeled sources

### Description

Both Go and C++ adapters validate “looks like language X but missing labels/rule_type.” Extract a shared helper to keep messages and behavior consistent.

### Scope & Changes

- Add `validateLanguageClassification(nodes, { looksLike, hasRuleType, hasLangLabel, name })` in `build-tools/tools/buck/exporter/lang/helpers.ts`.
- Replace inline checks in `exporter/lang/go.ts` and `exporter/lang/cpp.ts` with the helper.
- Keep severity policy unchanged (exporter main determines warn/error mode).

### Acceptance Criteria

- Same findings text style for both languages; snapshot tests updated if wording normalized.
- No change in exporter outcomes besides messaging normalization.

### Risks

- Low: helper consolidation only.

### Consequence of Not Implementing

- Minor duplication persists; messages can drift.

### Downsides for Implementing

- None material.

### Recommendation

- Implement. Small, high‑signal cleanup.

## PR‑4: Move Node lockfile sidecar emission out of exporter core

### Description

`build-tools/tools/buck/exporter/main.ts` emits `build-tools/tools/buck/node-lock-index.json`. Relocate this to the Node adapter or to the glue step so the exporter core stays adapter‑agnostic.

### Scope & Changes

- Option A (adapter‑local): generate the sidecar from `exporter/lang/node.ts` after label attach.
- Option B (glue): drop sidecar from exporter and emit it in `build-tools/tools/buck/gen-provider-index.ts` (already run by `build-tools/tools/patch/glue.ts`) or add a tiny `gen-lock-index.ts` called from glue.
- Keep the file path and schema unchanged.

### Acceptance Criteria

- `node-lock-index.json` continues to appear with identical content/order during glue runs.
- Exporter main drops Node‑specific side effects; adapters remain discoverable/parallelizable.

### Risks

- Low: ensure consumers (if any) read the same path; glue already runs in local/CI flows.

### Consequence of Not Implementing

- Exporter core remains slightly coupled to Node details.

### Downsides for Implementing

- Extra call in glue if Option B; negligible runtime cost.

### Recommendation

- Implement (Option B preferred for clearer separation). Adapter‑only is acceptable if simpler.

## PR‑5: Share patch apply/verify and filename encoding helpers

### Description

`patch-go.ts` and `patch-cpp.ts` duplicate apply/verify flows (parse flags, write canonical patch, run `patch -p1 --dry-run`). Filename encoding helpers also diverge (Go import path vs dotted nix attr). Centralize both.

### Scope & Changes

- Add `build-tools/tools/patch/lib/apply.ts` with:
  - flag parsing (`--target`, `--patch-dir`, `--force`),
  - “write canonical patch if changed” logic,
  - verify via `patch -p1 --dry-run`.
- Extend `build-tools/tools/lib/providers.ts` (or add `build-tools/tools/lib/patch-encoding.ts`) with:
  - `encodeImportPathForPatchFilename()` (existing),
  - `encodeNixAttrForPatchFilename()` (normalize `pkgs.foo` → `pkgs__foo`).
- Update Go/C++ patch handlers to use both helpers.
- Remove unused imports (e.g., `runGlue` in `patch-go.ts`).

### Acceptance Criteria

- Behavior identical on apply/no‑op/apply‑with‑force, with the same file names and diff content.
- Verification step continues to fail fast on un‑applicable diffs.
- Encoding helpers produce bit‑for‑bit identical names to current logic.

### Risks

- Low/Medium: centralizing logic can surface hidden assumptions. Mitigate via existing zx tests.

### Consequence of Not Implementing

- Ongoing duplication and small drift risks in patch workflows.

### Downsides for Implementing

- Small new shared surface; easy to test.

### Recommendation

- Implement. It reduces maintenance and improves reliability of patch flows.

## PR‑6 (Nice‑to‑have): Tests/docs touch‑ups and minor cleanups

### Description

Add/align tests for the refactors and clean trivial drift (unused imports, message consistency). Keep scope small and mechanical.

### Scope & Changes

- Tests:
  - Exporter validation helper is exercised across both languages with consistent messages.
  - Patch apply/verify helpers covered for Go and C++ (no‑op vs force overwrite).
  - Sidecar generation verified post‑glue (not in exporter main).
- Docs:
  - Update `docs/handbook/patching.md` for unified dev‑override UX.
  - Mention Node sidecar now emitted during glue, not exporter.
- Minor code cleanups: remove unused imports and dead branches found during refactor.

### Acceptance Criteria

- New tests stable locally and in CI; no behavior regressions.
- Docs reflect the small UX alignments succinctly.

### Risks

- Low: test and doc churn; keep changes scoped.

### Consequence of Not Implementing

- Refactors land without the last mile of assurance and docs parity.

### Downsides for Implementing

- Slight CI time from new tests (kept minimal).

### Recommendation

- Implement. Locks in parity and makes future changes safer.

## Rollout & Sequencing

1. PR‑1 (Node planner plugin): safe refactor; land first to stabilize planner surface.
2. PR‑2 (dev‑override UX): land second to align patching ergonomics early.
3. PR‑3 (exporter validation helper): land third; normalizes diagnostics.
4. PR‑4 (Node sidecar move): land after PR‑1/PR‑3 to avoid conflicts; glue picks up duty.
5. PR‑5 (shared patch helpers): land once flows are stable; update tests together.
6. PR‑6 (tests/docs/cleanups): land incrementally or at the end to consolidate parity.

Each PR:

- Runs the full test suite in the dev shell and keeps CI green.
- Avoids modifying existing spec tests unless wrong; prefer additive tests.

## Verification & Backout Strategy

- Verification: exporter/builder snapshot checks; provider‑wiring e2e; patch apply/no‑op; sidecar presence after glue.
- Backout: each PR is isolated and reversible; expect only minor merge resolution in shared files.

## Summary of Expected Impact

- Planner fully plugin‑ized for Node, keeping it dispatch‑only.
- Consistent patch dev‑override UX across Go/C++ with centralized helpers.
- Normalized exporter diagnostics; sidecar emission moved out of exporter core.
- Shared patch apply/verify and encoding helpers reduce duplication.
- Small cleanups/tests reinforce parity and future maintainability.
