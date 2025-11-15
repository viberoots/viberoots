## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 6

This plan continues the consolidation from Parts 3–5. Each PR is small, independently reversible, and targets high value-per-effort improvements: unified CLI ergonomics, bootstrap safety, consistent lockfile discovery, and tighter glue standardization — all without changing behavior or invalidation semantics.

## PR‑1: Unified CLI flag parsing helpers across glue tools

### Description

Replace bespoke `getArg/flagStr/flagBool` snippets across glue scripts with a single helper library (`tools/lib/cli.ts`) that provides consistent typed accessors and fallbacks.

### Scope & Changes

- Add `tools/lib/cli.ts` with:
  - `getFlagStr(name: string, def?: string): string`
  - `getFlagBool(name: string): boolean`
  - `getFlagList(name: string): string[]`
- Tests:
  - Add unit tests for helpers (argv object vs process.argv vs default precedence, equals‑form flags, list parsing, boolean switches).
- Docs:
  - Update glue tooling docs to reference the shared `tools/lib/cli.ts` helpers and show one canonical usage snippet.
- Migrate callers:
  - `tools/buck/gen-auto-map.ts`, `tools/buck/sync-providers.ts`, `tools/buck/prebuild-guard.ts`
  - `tools/buck/gen-provider-index.ts`, `tools/ci/run-stage.ts`, `tools/dev/build-selected.ts`
- Keep exact current defaults and precedence (argv object → process.argv → default).

### Acceptance Criteria

- No output diffs from any migrated script on a clean tree.
- New helper unit tests cover empty/explicit/equals-form flags and list parsing.
- Docs merged; examples align with helper behavior.

### Risks

Low. Thin mechanical substitutions.

### Consequence of Not Implementing

Small drift and subtle flag handling differences over time.

### Downsides for Implementing

Minor churn in imports and function calls.

### Recommendation

Implement.

## PR‑2: Bootstrap‑safe glue/CI entrypoints (remove fs‑extra)

### Description

Ensure all glue/CI runners execute before `node_modules` are linked. Replace `fs-extra` usage with `node:fs/promises` or existing helpers.

### Scope & Changes

- Update scripts that currently import `fs-extra`:
  - `tools/ci/run-stage.ts`, `tools/dev/planner-gen.ts`, `tools/dev/langs-diagnose.ts`
  - Any other glue entrypoints invoked pre‑install
- Use `node:fs/promises` and `tools/lib/fs-helpers.ts` where appropriate.
- Keep behavior and logging identical.
- Tests:
  - Add zx tests that execute glue stages (`export-graph`, `sync-providers`, `gen-auto-map`, `prebuild-guard`) in a temp repo without `node_modules`, asserting exit 0 and no diffs vs. baseline outputs.
- Docs:
  - Add a short “bootstrap‑safe glue” note in troubleshooting/developer workflow pages emphasizing no dependency on `fs-extra`.

### Acceptance Criteria

- All glue and CI runners function in a fresh dev shell without `pnpm install`.
- No behavior diffs; snapshots and outputs unchanged.
- Docs merged; guidance on bootstrap safety present.

### Risks

Low. Straightforward API substitutions.

### Consequence of Not Implementing

Intermittent bootstrap failures when `node_modules` is unavailable.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑3: Shared lockfile discovery helper

### Description

Centralize discovery of `pnpm-lock.yaml` files (with common ignores) into a reusable helper.

### Scope & Changes

- Add `tools/lib/lockfiles.ts`:
  - `findPnpmLockfiles(opts?: { roots?: string[]; ignore?: string[] }): Promise<string[]>`
- Update callers to use the helper:
  - `tools/buck/providers/node.ts`, `tools/dev/langs-diagnose.ts`, `tools/buck/gen-provider-index.ts`
- Keep current ignore set (e.g., `.git`, `buck-out`, `node_modules`, `.pnpm-store`, `.clinic`, `coverage`) and deterministic ordering.
- Tests:
  - Add zx/unit tests covering ignore handling, multiple roots, deterministic ordering, and empty‑tree behavior.
- Docs:
  - Update the provider sync cookbook to reference `findPnpmLockfiles()` and describe the standard ignore set and ordering guarantees.

### Acceptance Criteria

- No diff in generated provider files or indexes on a clean tree.
- Helper unit tests cover directories, ignores, and ordering.
- Docs merged; cookbook references the helper and its behavior.

### Risks

Low. Refactor to a shared utility.

### Consequence of Not Implementing

Duplicated tree-walk logic and potential drift in ignore rules.

### Downsides for Implementing

Minimal refactor; small test updates.

### Recommendation

Implement.

## PR‑4: Standardize Composite Graph consumption

### Description

Ensure all glue scripts that read the Buck graph consume it via the Composite Graph API (`tools/lib/graph-view.ts`) rather than ad‑hoc JSON reads.

### Scope & Changes

- Audit and update any remaining direct `graph.json` reads in glue to use:
  - `readCompositeGraph({ graphPath?, providerIndexPath?, nodeLockIndexPath? })`
- Keep behavior identical, rely on sidecars when present, and tolerate absence gracefully where documented.
- Tests:
  - Add zx tests that run affected scripts before and after the change in a temp repo, asserting identical outputs and tolerant behavior when sidecars are missing.
- Docs:
  - Add a brief “Composite Graph API” section (tools reference) with the `tools/buck/graph-view.ts` CLI example.

### Acceptance Criteria

- No diffs in outputs of `gen-auto-map`, provider index, or diagnostics.
- Tests for missing/partial sidecars remain green.
- Docs merged; reference section added.

### Risks

Low. API already used by multiple tools.

### Consequence of Not Implementing

Incremental drift and duplicated parsing logic.

### Downsides for Implementing

Small edits; additional imports.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑2 (Bootstrap‑safe glue/CI) — removes operational footguns in early flows
2. PR‑1 (Unified CLI helpers) — centralizes flag handling before broader edits
3. PR‑3 (Shared lockfile discovery) — prepares provider/index tools for consistency
4. PR‑4 (Composite Graph standardization) — unify graph consumption across tools

## Verification & Backout Strategy

- Verification:
  - PR‑1: Run all affected scripts; assert no output diffs vs. baseline. Unit tests cover helpers.
  - PR‑2: Execute glue stages in a clean dev shell without `node_modules`; all succeed.
  - PR‑3: Compare provider targets and indexes before/after; no diffs by default.
  - PR‑4: Swap to Composite Graph; outputs unchanged; simulate missing sidecars to verify graceful handling.
- Backout:
  - Each PR is isolated (helpers/scripts/docs). Revert individually with no cross‑PR coupling.

## Summary of Expected Impact

- Reduced duplication in CLI parsing and lockfile discovery
- More reliable bootstrap for glue/CI entrypoints
- Consistent Composite Graph consumption across glue tools
- Documentation/tests included with each PR to lock in guarantees without altering behavior
