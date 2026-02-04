## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 10

This plan lands small, high‑value refinements to keep abstractions tight and reduce duplication. It focuses on standardizing C++ test runners on the shared nix‑shell helpers and optionally extracting a lockfile label helper for Node macros. Behavior is intended to remain unchanged; only implementation consistency improves.

## PR‑1: C++ external tests reuse shared nix‑shell helpers

### Description

Unify the C++ ExternalRunner test rule with Node by reusing `nix_bootstrap_env()` and `nix_timeout_wrapper_var()` from `//build-tools/lang:nix_shell.bzl`. Today, `build-tools/cpp/private/nix_test.bzl` embeds a custom bootstrap/timeout shell sequence. This refactor reduces duplication and keeps timeouts and environment handling consistent across languages. No functional change expected.

### Scope & Changes

- `build-tools/cpp/private/nix_test.bzl`:
  - Load and use `nix_bootstrap_env()` and `nix_timeout_wrapper_var()` in the test runner command.
  - Preserve existing semantics for `planner_label`, expected binary name resolution (`sanitize_to_bin_name`), and fallback lookup.
- Documentation:
  - Add a short note under the C++ testing section (or general test infra notes) that C++ tests now use the shared nix‑shell bootstrap and timeout wrapper for parity with Node.

### Acceptance Criteria

- Running representative C++ tests via `buck2 test //...` passes with no behavioral differences.
- No cquery or provider‑edge diffs beyond expected test stamp nodes.
- Default external timeout behavior matches Node (10 minutes unless overridden by repo conventions).
- CI remains green on all supported architectures.

### Risks

Low. The change replaces inlined shell fragments with battle‑tested shared helpers.

### Consequence of Not Implementing

Duplicate bootstrap/timeout logic persists in C++ tests, creating drift and future maintenance overhead.

### Downsides for Implementing

None material. Small refactor introduces an additional import in one file.

### Recommendation

Implement.

## PR‑2: Optional — Extract Node lockfile label helpers to `build-tools/lang/defs_common.bzl`

### Description

Factor Node’s lockfile label parsing/enforcement into shared helpers so Node macros call a canonical implementation and future languages can reuse it if needed. Behavior and error messages remain the same.

### Scope & Changes

- `build-tools/lang/defs_common.bzl`:
  - Add helpers analogous to Node’s `_extract_lockfile_labels()` and `_ensure_lockfile_label()` (names appropriate for shared use).
  - Preserve current semantics: exactly one importer‑scoped label required; stable dedupe; precise error text.
- `build-tools/node/defs.bzl`:
  - Replace local helpers with imports from `build-tools/lang/defs_common.bzl` in `nix_node_gen` and `nix_node_test`.
- Documentation:
  - Mention the shared helpers in the handbook’s “Adding a Language” and Node macro sections as the canonical place for importer‑scoped label handling.

### Acceptance Criteria

- No changes to `buck2 cquery` results for representative Node targets.
- No changes to exporter validation findings for Node targets.
- Provider sync output remains byte‑for‑byte identical given the same inputs when invoked through the unified orchestrator:
  - `node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`
- All zx tests for provider wiring and Node scaffolding pass locally and in CI.

### Risks

Low. It is a pure extraction with equivalent logic.

### Consequence of Not Implementing

Small duplication remains in Node macros; minor risk of future drift if logic evolves.

### Downsides for Implementing

Introduces an additional shared helper surface, albeit tiny and well‑scoped.

### Recommendation

Implement (optional). Safe to defer if churn is undesirable.

## Rollout & Sequencing

1. PR‑1 (C++ tests reuse shared nix‑shell helpers) — zero behavior change; reduces duplication.
2. PR‑2 (Optional Node lockfile helper extraction) — zero behavior change; improves reuse and reduces duplication.

Each PR is independent and reversible. Land with green CI.

## Verification & Backout Strategy

- Verification (per PR):
  - PR‑1: Run representative C++ tests across platforms; confirm pass/fail and timeouts match existing behavior. Ensure no unintended cquery diffs beyond test stamps.
  - PR‑2: Compare `buck2 cquery` and provider sync outputs pre/post; run existing zx tests for Node providers and macros; expect identical artifacts.
- Backout:
  - Revert individual PRs cleanly. Both are leaf‑level edits and do not change public APIs beyond imports.

## Summary of Expected Impact

- Less duplication and tighter parity across languages for test bootstrap/timeout handling.
- Cleaner Node macros via shared lockfile label helpers (optional), reducing risk of divergence over time.
