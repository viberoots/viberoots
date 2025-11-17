## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 13

This plan proposes small, high‑value refinements that remove duplication, tighten cross‑language boundaries, and align ergonomics. All items are scoped to be low‑risk and independently reversible with no behavioral changes to builds or labeling.

## PR‑1: Centralize lockfile label parsing helper (TS)

### Description

Unify parsing of importer‑scoped lockfile labels into a single helper to avoid drift and keep validations consistent across tools that interpret `lockfile:<path>#<importer>`.

### Scope & Changes

- `tools/lib/labels.ts`:
  - Add `parseLockfileLabel(label: string): { lockfile: string; importer: string } | null`.
  - Add `isImporterScopedLockfileLabel(label: string): boolean` (thin wrapper).
- `tools/buck/exporter/lang/node.ts`:
  - Replace the local `parseLockLabel` with the shared helper.
  - Use the helper in `validateSingleImporterLabel`.
- `tools/buck/gen-provider-index.ts`:
  - Replace the local regex parser with the shared helper.
- Tests:
  - New: `tools/tests/lib/labels.parse-lockfile-label.test.ts` to cover edge cases (root `.` importer, nested importers, bad formats).

### Acceptance Criteria

- For the same inputs, `tools/buck/graph.json` and provider index outputs are byte‑for‑byte identical pre/post.
- All existing exporter/provider zx tests remain green without updates.

### Risks

Low. Pure extraction with identical semantics; primary risk is a missed import or minor path normalization mismatch covered by tests.

### Consequence of Not Implementing

Parsing logic can drift across modules, increasing maintenance cost and the chance of subtle mismatches.

### Downsides for Implementing

Minimal churn (imports), one new test.

### Recommendation

Implement.

## PR‑2: Single source of truth for DEFAULT_GRAPH_PATH (TS)

### Description

Deduplicate the default graph path constant so all consumers import it from one module.

### Scope & Changes

- `tools/lib/graph-view.ts`:
  - Remove the local `DEFAULT_GRAPH_PATH`; import from `tools/lib/graph-const.ts`.
- Audit scripts that hardcode the default (e.g., CLI defaults) and, when feasible, import the shared constant:
  - Keep CLI flags/overrides intact; only unify the fallback default value.
- Tests: none expected.

### Acceptance Criteria

- No changes to outputs or behavior when flags/env are the same as before.
- Grep shows no remaining duplicate constant definitions for the default graph path.

### Risks

Very low. Imports only.

### Consequence of Not Implementing

Minor risk of default path drift between modules leading to confusing “file not found” scenarios.

### Downsides for Implementing

Trivial refactor.

### Recommendation

Implement.

## PR‑3: Go planner helper deduplication (Nix)

### Description

Reduce duplication in `tools/nix/planner/go.nix` by relying more on shared helpers and lifting repeated local helpers once per file.

### Scope & Changes

- `tools/nix/planner/go.nix`:
  - Replace repeated inline constructions of `byName`, `depsOfName`, and `labelsOfName` inside `mkApp` and `mkLib` with top‑level bindings.
  - Prefer existing functions from `tools/nix/planner/lib.nix` (`byName`, `depsOf`, `labelsOf`) where possible.
- Optional (only if clearly beneficial): extend `tools/nix/planner/lib.nix` with narrow helper(s) to avoid re‑creating trivial lookups in language plugins.

### Acceptance Criteria

- For representative Go targets, resulting derivations (store paths) and `nix build .#graph-generator` outputs are unchanged.
- File is shorter and easier to read; no loss of clarity.

### Risks

Low. Behavior‑preserving refactor; primary risk is a missed reference. Changes are localized and easy to revert.

### Consequence of Not Implementing

Ongoing duplication increases the chance of subtle divergence and hinders readability.

### Downsides for Implementing

Small, localized churn.

### Recommendation

Implement.

## PR‑4: Extract exporter validation/severity logic (TS)

### Description

Move validation severity selection and presentation from `tools/buck/exporter/main.ts` into `tools/buck/exporter/validation.ts` to reduce file size and align with methodology constraints, without changing behavior.

### Scope & Changes

- `tools/buck/exporter/main.ts`:
  - Extract the mode selection (`warn`/`error`, CI override), adapter validation aggregation, and logging to a new module.
  - Keep the exact message text and timing prints.
- `tools/buck/exporter/validation.ts` (new):
  - Export small, pure functions used by `main.ts`.
- Tests: run existing zx tests; no changes expected.

### Acceptance Criteria

- For identical inputs, emitted `graph.json` and console output (including validation warnings/errors and timing lines) are unchanged.
- `main.ts` decreases in size and passes the project’s file‑size guideline.

### Risks

Low. Refactor only; message and exit behavior must remain identical.

### Consequence of Not Implementing

`main.ts` remains larger and slightly harder to maintain.

### Downsides for Implementing

Minimal module split.

### Recommendation

Implement (behavior‑preserving refactor).

## PR‑5: Sync‑providers tiny cleanup (TS)

### Description

Fix minor identifier typos and add a guard test to prevent regressions. No behavior change.

### Scope & Changes

- `tools/buck/sync-providers.ts`:
  - Rename `targetLgLangRequested` → `targetLangRequested`; `EMETIndexRequested` → `EMITIndexRequested` (or equivalent clear names).
- Tests:
  - Add a tiny zx test that imports the module and exercises the renamed functions via a dry‑run path to ensure they remain referenced correctly.

### Acceptance Criteria

- No diffs in generated provider/auto_map files for the same inputs.
- New test passes locally and in CI.

### Risks

None. Naming only.

### Consequence of Not Implementing

Minor confusion and lint noise from typos.

### Downsides for Implementing

Negligible churn.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Lockfile parser helper) — centralizes logic with tests; land first.
2. PR‑2 (Graph path constant) — trivial dedup; land next.
3. PR‑3 (Go planner dedup) — behavior‑preserving refactor; land after 1–2.
4. PR‑4 (Exporter validation extraction) — refactor; land when convenient.
5. PR‑5 (Sync‑providers cleanup) — safe anytime after 1–2.

All PRs are independent and reversible.

## Verification & Backout Strategy

- PR‑1:
  - Run existing exporter/provider zx tests; confirm `graph.json` and provider index outputs unchanged for representative repos.
  - Backout: revert helper adoption and restore prior local parsers.
- PR‑2:
  - Smoke run `export-graph`, `sync-providers`, `gen-auto-map` with and without explicit `--graph`; verify behavior unchanged.
  - Backout: revert imports to previous constant definitions.
- PR‑3:
  - Build representative Go targets and `nix build .#graph-generator`; confirm no store path or output diffs.
  - Backout: restore inline helpers in `go.nix`.
- PR‑4:
  - Compare console output from exporter pre/post for a fixed graph; confirm identical messages and exit codes.
  - Backout: move logic back into `main.ts`.
- PR‑5:
  - Run the new guard test and existing provider sync tests; confirm no diffs.
  - Backout: rename functions back (no impact on artifacts).

## Summary of Expected Impact

- Reduced duplication and tighter boundaries across Go/C++/Node scripting and Nix planners.
- Lower drift risk for lockfile label parsing and default graph path usage.
- Improved readability and maintainability (smaller exporter main file, fewer local helper copies).
- No behavioral changes to builds, labels, or provider mapping; changes are refactors with tests to ensure parity.
