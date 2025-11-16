## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 7

This plan advances the cross-language consolidation with small, reversible PRs that tighten abstractions without changing behavior, invalidation semantics, or outputs. The focus is eliminating duplicate helpers, standardizing utilities, and light DRY inside language planners/templates. Each PR stands alone and is safe to back out.

## PR‑1: Nix dev‑override consolidation (single source of truth)

### Description

Unify dev‑override handling in Nix to a single helper so Go/CPP templates and future languages share identical CI guardrails and local warnings.

### Scope & Changes

- Make `tools/nix/lib/lang-helpers.nix` the authoritative source for:
  - `readDevOverrides envName`
  - `guardNoDevOverridesInCI envName`
- Update call sites in language templates/planners to import from `lang-helpers.nix`.
- Deprecate `tools/nix/dev-overrides.nix`:
  - Option A (preferred): remove it.
  - Option B: re‑export functions from `lang-helpers.nix` to avoid drift (no new behavior).
- Docs: brief note in build-system design about the canonical location.

### Acceptance Criteria

- No diffs in any realized derivations or logs in both local and CI runs.
- CI continues to fail when overrides are set; local evaluation logs the same warning string.
- All templates/planners import the unified helpers.

### Risks

Low. Pure refactor of imports; behavior preserved.

### Consequence of Not Implementing

Slow drift in warning text and CI enforcement across languages.

### Downsides for Implementing

Minor churn touching imports.

### Recommendation

Implement.

## PR‑2: Nix patch map — single implementation

### Description

Eliminate duplicate “patch filename → module@version list” scanners by keeping one implementation.

### Scope & Changes

- Retain `patchesMapFromDir` in `tools/nix/lib/lang-helpers.nix` as canonical.
- Update `tools/nix/templates/*.nix` to use the canonical helper.
- Deprecate `tools/nix/templates-common.nix`:
  - Option A (preferred): remove file.
  - Option B: thin wrapper that imports/exports from `lang-helpers.nix`.
- Docs: one-sentence pointer to the canonical helper.

### Acceptance Criteria

- No derivation or output diffs on a clean tree.
- All references to `patchesMapFromDir` point to one source.

### Risks

Low. Mechanical rewrite of imports.

### Consequence of Not Implementing

Inconsistent decoding rules for patch file names over time.

### Downsides for Implementing

Minor file churn.

### Recommendation

Implement.

## PR‑3: Shared hashing and CLI helpers (TypeScript)

### Description

Remove small duplication in TS utilities and standardize CLI parsing across zx tools.

### Scope & Changes

- Move `shortHash` to a single definition:
  - Keep it in `tools/lib/providers.ts`.
  - Update `tools/lib/provider-names.ts` to import it; remove duplicate implementation.
- Adopt `tools/lib/cli.ts` across remaining bespoke callers:
  - Migrate `tools/patch/patch-pkg.ts` (replace local parser with `getFlagStr/getFlagBool/getFlagList` where applicable).
- Tests:
  - Add small unit tests for `shortHash` import path.
  - Ensure `patch-pkg` flag behavior remains identical (argv precedence).
- Docs:
  - Reference `tools/lib/cli.ts` as the canonical way to read flags in zx tools.

### Acceptance Criteria

- No output diffs for provider/gen scripts and `patch-pkg` behavior (flags/precedence unchanged).
- All TS sites use the unified `shortHash`.

### Risks

Low. Thin refactor.

### Consequence of Not Implementing

Minor duplication and potential drift in flag parsing and hashing.

### Downsides for Implementing

Small edits and imports.

### Recommendation

Implement.

## PR‑4: Light DRY inside Go planner/template (no behavior change)

### Description

Reduce internal duplication in Go Nix templates and the Go planner plugin while keeping the current outputs and environment logic intact.

### Scope & Changes

- `tools/nix/templates/go.nix`:
  - Extract a tiny internal composer for shared `configurePhase`/env pieces used by `goApp` and `goLib`.
- `tools/nix/planner/go.nix`:
  - Factor a local helper to compute `patchDirsAbs` from `srcs` (used by `mkApp` and `mkLib`).
- No interface changes; no attribute/flag changes.

### Acceptance Criteria

- No derivation or output diffs across representative Go targets (bin/lib).
- Same CGO enablement behavior and patches application.

### Risks

Low. Pure internal DRY; contained to Go.

### Consequence of Not Implementing

Small duplication persists; harder to keep behaviors aligned.

### Downsides for Implementing

Minimal code motion; review burden.

### Recommendation

Implement.

## PR‑5: Reusable “assume‑unchanged” index hint helper (optional)

### Description

Extract the recurring git index hint used when overwriting generated files into a tiny helper to avoid re‑implementations and keep behavior identical.

### Scope & Changes

- Add `maybeAssumeUnchanged(file: string)` to `tools/lib/fs-helpers.ts`.
- Update `tools/buck/gen-auto-map.ts` (and any other script that sets the hint) to call the helper.
- Behavior preserved: best‑effort, tolerant outside a git work tree.

### Acceptance Criteria

- No diffs in generated files; identical console behavior.
- Helper is the only place that implements this pattern.

### Risks

Low. Cosmetic consolidation.

### Consequence of Not Implementing

Tiny duplication persists.

### Downsides for Implementing

None material.

### Recommendation

Implement (optional; can be folded into any PR).

## Rollout & Sequencing

1. PR‑1 (Nix dev‑override consolidation) — ensures consistent CI guardrails first
2. PR‑2 (Nix patch map single source) — unifies patch scanning logic
3. PR‑3 (Shared hashing/CLI helpers) — standardize zx utilities across tools
4. PR‑4 (Go planner/template DRY) — internal cleanup with zero behavior change
5. PR‑5 (Index hint helper) — optional polish at the end

## Verification & Backout Strategy

- Verification:
  - For each PR, run representative builds/tests and snapshot generated glue/derivations; assert no diffs.
  - For PR‑3, add tests around flag precedence and hashing import path; confirm `patch-pkg` UX unchanged.
  - For PR‑1/PR‑2/PR‑4, compare planner logs (where present) and rule keys on sample targets.
- Backout:
  - Each PR is isolated to helpers/imports or local DRY; revertable independently with no cross‑PR coupling.

## Summary of Expected Impact

- Reduced duplication in Nix helpers (dev overrides, patch maps)
- Consistent CLI parsing and hashing across zx scripts
- Smaller Go planner/template surface with identical behavior
- Slightly simpler maintenance and lower risk of cross‑language drift
