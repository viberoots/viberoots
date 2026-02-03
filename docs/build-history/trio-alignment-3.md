## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 3

This plan assumes the PRs from `trio-alignment-2.md` are landed or in-flight. It focuses on small, high-value refactors that further tighten cross‑language abstractions without changing core behavior. Each PR is independent, low-risk, and backed by targeted tests.

## PR‑1: Deterministic IO and stamps 100% uniform

### Description

Unify all generator and glue writes on the shared deterministic IO helpers to eliminate output churn and drift. This makes repeated runs no‑ops when inputs are unchanged.

### Scope & Changes

- Ensure all relevant scripts import and use:
  - `tools/lib/fs-helpers.ts`: `writeIfChanged`, `writeStamp`, `stableUnique`
- Apply to:
  - Provider generators under `tools/buck/providers/*.ts` (Node, C++, future languages)
  - `tools/buck/gen-auto-map.ts` and `tools/buck/gen-provider-index.ts`
  - Any glue or dev scripts that still hand‑roll conditional writes

### Acceptance Criteria

- Re-running provider sync, auto‑map, and provider‑index back‑to‑back produces no diffs when inputs are unchanged.
- Existing content and ordering are preserved bit‑for‑bit (no behavior changes).
- Keep or add a small zx test proving idempotent writes on a second run.

### Risks

Low. Refactor-only; behavior preserved.

### Consequence of Not Implementing

Occasional needless diffs/churn in generated files; fragile parity across languages.

### Downsides for Implementing

Minimal code motion; import adjustments.

### Recommendation

Implement.

## PR‑2: Consolidate label normalization utilities

### Description

Centralize label normalization (drop cell/config suffixes, stable formatting) in one helper to avoid subtle divergences between exporter, glue, and dev tools.

### Scope & Changes

- Add `tools/lib/labels.ts` with small utilities for:
  - Dropping `(config//...)` suffixes
  - Normalizing `//cell//pkg:rule` forms for display/keys
- Replace local ad‑hoc versions in:
  - Exporter helpers
  - `tools/buck/gen-auto-map.ts`
  - Dev/glue helpers that derive package names from labels

### Acceptance Criteria

- All touched scripts produce identical outputs pre/post change.
- Add a tiny unit test for normalization on representative label samples.

### Risks

Low. Pure refactor.

### Consequence of Not Implementing

Minor duplication and message/key drift over time.

### Downsides for Implementing

Small import churn.

### Recommendation

Implement.

## PR‑3: Canonical graph export helper (single source of truth)

### Description

Adopt one exported `ensureGraph()` helper and reuse it in both local glue and dev/CI paths to avoid multiple slightly different code paths for exporting the configured graph.

### Scope & Changes

- Export a single `ensureGraph()` from a shared place (e.g., `tools/buck/glue-run.ts` or reuse `tools/patch/glue.ts` and re-export from a buck-local shim).
- Update:
  - `tools/dev/build-selected.ts`
  - `tools/buck/prebuild/repair.ts`
  - CI stage runner where it invokes the exporter directly

### Acceptance Criteria

- Graph export runs exactly once when missing; reruns are no‑ops.
- Behavior identical; existing flags/env are preserved.
- Add a smoke zx test that runs ensure twice and asserts no write on the second call.

### Risks

Low. Pure glue consolidation.

### Consequence of Not Implementing

More surfaces to maintain; potential divergence in edge‑case handling.

### Downsides for Implementing

Minor dependency wiring between helpers.

### Recommendation

Implement.

## PR‑4: Eliminate fs‑extra in pre‑install glue paths

### Description

Ensure any glue/install scripts that may run before `node_modules` exist rely only on `node:fs/promises` and built‑ins, per repo policy. Keep `fs-extra` only in scripts guaranteed to run with dependencies installed.

### Scope & Changes

- Audit and adjust early‑path scripts (e.g., export/ensureGraph, prebuild guard/repair) to use `node:fs/promises`.
- Retain `fs-extra` in normal generators where it’s already present and safe.

### Acceptance Criteria

- Early-path scripts run without `node_modules` present and behave identically when `node_modules` is present.
- No change in outputs or ordering.

### Risks

Low. Straightforward module substitutions.

### Consequence of Not Implementing

Potential failures when glue runs before dependency install.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑5: Adopt shared Nix templates‑common across Go/C++

### Description

Use a shared Nix helpers module for dev overrides and patch map generation across Go/C++, rather than duplicating logic in each language template.

### Scope & Changes

- Introduce or ensure a `tools/nix/templates-common.nix` with:
  - `patchesMapFromDir`
  - `readDevOverrides ENV` and `guardNoDevOverridesInCI ENV`
- Update Go and C++ templates to import common helpers and remove duplicated logic.

### Acceptance Criteria

- Derivations are bit‑identical; CI dev‑override failure semantics unchanged.
- Minimal Nix diffs; tests continue to pass.

### Risks

Low. Refactor-only at Nix eval time.

### Consequence of Not Implementing

Duplication and drift between languages over time.

### Downsides for Implementing

Small Nix refactor and import wiring.

### Recommendation

Implement.

## PR‑6: Starlark ↔ Nix sanitizer parity test (C++)

### Description

Add a parity test to ensure C++ artifact name sanitization is consistent between Starlark and Nix. Adjust only if a mismatch is surfaced.

### Scope & Changes

- Add zx test that:
  - Reads sanitizer output from Starlark probe for a table of tricky labels.
  - Compares to Nix sanitizer for the same inputs.
- Fix sanitizer if parity fails; otherwise keep logic as-is.

### Acceptance Criteria

- Test passes across supported platforms.
- No behavior changes unless a real mismatch is uncovered (then align).

### Risks

Low. Guardrail only.

### Consequence of Not Implementing

Potential subtle naming mismatches across toolchains.

### Downsides for Implementing

Small additional test runtime.

### Recommendation

Implement.

## PR‑7: Graph API naming alignment (paper cut)

### Description

Align docs and code for the composite graph API. Provide a tiny `tools/lib/graph-view.ts` forwarder if needed, or update docs to point to the actual module name.

### Scope & Changes

- If the code already uses `tools/lib/graph.ts`, create a minimal `graph-view.ts` that re-exports it, or update the documentation references to the correct path.

### Acceptance Criteria

- Docs and code paths match; no onboarding confusion.
- No behavior changes.

### Risks

None.

### Consequence of Not Implementing

Minor onboarding friction.

### Downsides for Implementing

Trivial file or doc change.

### Recommendation

Implement.

## PR‑8: Glue orchestration convergence for CI/local

### Description

Prefer a single glue runner (export graph → provider index → auto‑map) that is imported by both CI and local flows, instead of open-coding the sequence in multiple places.

### Scope & Changes

- Export `runGlue()` from a single module (e.g., `tools/buck/glue-run.ts` or re-export from `tools/patch/glue.ts`).
- Update:
  - `tools/ci/run-stage.ts` to call the shared runner for glue
  - `tools/buck/prebuild/repair.ts` to reuse the same helper sequence

### Acceptance Criteria

- Identical outputs (paths and content) in CI and local runs.
- Fewer duplicate command sequences to maintain.

### Risks

Low. Refactor-only.

### Consequence of Not Implementing

Duplicated glue sequences with potential for drift.

### Downsides for Implementing

Small code motion; import adjustments.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Deterministic IO) — stabilizes write semantics everywhere.
2. PR‑2 (Label utilities) — centralizes normalization before touching more callers.
3. PR‑3 (Canonical ensureGraph) — unifies the export path.
4. PR‑4 (fs‑extra‑free early paths) — removes fragile deps in early glue.
5. PR‑5 (Nix templates‑common) — aligns language templates on the same helpers.
6. PR‑6 (Sanitizer parity test) — adds guardrail; only code change if mismatch.
7. PR‑7 (Graph API naming) — documentation/forwarder to avoid papercuts.
8. PR‑8 (Glue orchestration convergence) — reduces duplication across flows.

Each PR is small and independently reversible; land with green CI.

## Verification & Backout Strategy

- Verification:
  - Idempotent write tests for generators and glue (PR‑1).
  - Unit tests for label normalization on representative samples (PR‑2).
  - Smoke test: run `ensureGraph()` twice, confirm second is a no‑op (PR‑3).
  - Early‑path scripts run without `node_modules`; same outputs when present (PR‑4).
  - Snapshot checks on derivations/graph outputs after template refactor (PR‑5).
  - Parity test for sanitizer; fix only if mismatch (PR‑6).
  - Provider‑wiring e2e remains green after glue consolidation (PR‑8).
- Backout:
  - Each PR touches focused files; revert individually with minimal conflicts.

## Summary of Expected Impact

- Tighter cross‑language parity and drift reduction (shared IO, labels, templates).
- Fewer duplicated glue sequences; simpler maintenance and safer changes.
- More robust early-path behavior (no implicit dependency on `fs-extra`).
- Improved determinism and idempotency, reducing CI diffs and local noise.
