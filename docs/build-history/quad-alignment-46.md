# Quad Alignment Plan - Close Remaining Cross-Language Gaps (CPP / Go / PNPM / Python) - Part 46

This plan closes the remaining gaps identified in the cross-language abstraction review.

Each PR includes code, tests, and documentation updates together.

Scope: provider-edge wiring consolidation, Nix planner kind config registry, importer-scoped
exporter adapter factoring, importer-scoped provider sync factoring, and removal of C++ sanitizer
indirection.

Non-goals: no standalone docs-only or tests-only PRs.

---

## PR-1: Consolidate provider-edge wiring on merge_provider_edges

### Description

I will make `merge_provider_edges(...)` the single public macro wiring entry point and migrate
planner-visible wiring and Rust stubs away from direct `realize_provider_edges(...)` usage. The
lower-level helper can remain internal, but call sites should route through the canonical helper to
keep dict-safe behavior and ordering consistent.

### Scope & Changes

- Update `lang/planner_visible_wiring.bzl`:
  - Replace direct `realize_provider_edges(...)` calls with `merge_provider_edges(...)`.
  - Preserve existing behavior for `provider_realization_mode` and `strip_providers_from_deps`.
- Update `build-tools/rust/defs.bzl`:
  - Replace direct `realize_provider_edges(...)` usage with `merge_provider_edges(...)`.
- If needed, adjust `lang/provider_edges.bzl` visibility or docstrings to clarify
  `merge_provider_edges(...)` as the canonical entry point.

### Tests (in this PR)

- Add or extend a probe test that asserts `wire_planner_visible_inputs(...)` uses dict-safe
  attachment when requested and preserves stable ordering.
- Extend the Rust stub test (or add a new probe) to confirm provider edges are realized through the
  canonical helper and remain deterministic.

### Docs (in this PR)

- Update `abstractions.md` to state `merge_provider_edges(...)` is the canonical public helper and
  that direct `realize_provider_edges(...)` calls are not part of macro wiring policy.

### Acceptance Criteria

- No macro-level wiring path calls `realize_provider_edges(...)` directly.
- Planner-visible stubs continue to realize provider edges correctly with the same behavior.
- Tests cover the updated wiring and pass.

### Risks

Behavior drift if a call site depended on `realize_provider_edges(...)` edge cases not mirrored by
`merge_provider_edges(...)`.

### Mitigation

Add a probe that compares pre- and post-merge ordering and contents for both list and dict-safe
paths, and keep behavior parity explicit in the test fixture.

### Consequence of Not Implementing

Provider-edge wiring continues to have multiple public paths and is easier to drift.

### Downsides for Implementing

Small refactors across shared Starlark helpers and probe tests.

### Recommendation

Implement.

---

## PR-2: Centralize Nix planner kind config in a shared registry

### Description

I will extract per-language `kindOf` configuration (label priorities and rule type tables) into a
shared registry so planners do not duplicate config tables. `build-tools/tools/nix/planner/lib.nix:kindOf` will
remain the logic engine, but each language will pull its config from the registry.

### Scope & Changes

- Add `build-tools/tools/nix/planner/kind-configs.nix` (or equivalent) containing per-language config tables.
- Update `build-tools/tools/nix/planner/go.nix`, `cpp.nix`, `python-core.nix`, and `node.nix` to import configs
  from the shared registry rather than inlining tables.
- Keep existing `kindOf` behavior unchanged.

### Tests (in this PR)

- Add a small Nix test (or extend an existing planner test) that asserts each language’s config is
  loaded from the shared registry and yields the same kinds for a fixed fixture graph.

### Docs (in this PR)

- Update `abstractions.md` to state that per-language `kindOf` config is centrally defined in the
  registry and referenced by planners, not duplicated.

### Acceptance Criteria

- `kindOf` decisions for Go/C++/Python/Node remain unchanged.
- No planner keeps an inline `kindOf` config table.
- Tests cover the new registry and pass.

### Risks

Accidental kind classification changes if a table is moved incorrectly.

### Mitigation

Add a fixture-based test that asserts a small matrix of labels and rule types yields the same kinds
before and after the refactor.

### Consequence of Not Implementing

Kind inference tables remain duplicated and more likely to drift across languages.

### Downsides for Implementing

Moderate refactor across multiple planner files and new registry wiring.

### Recommendation

Implement.

---

## PR-3: Factor importer-scoped exporter adapters for Node and Python

### Description

I will extract the shared adapter scaffolding for importer-scoped languages into a helper so the
Node and Python adapters do not duplicate validation and label-attachment logic.

### Scope & Changes

- Add a helper in `build-tools/tools/buck/exporter/lang/importer-scoped-adapter.ts` (or a new small file) that
  builds a standard adapter given `isTarget`, lockfile basename, and classification registry entry.
- Update `build-tools/tools/buck/exporter/lang/node.ts` and `python.ts` to use the helper.
- Preserve current warnings and validation behavior.

### Tests (in this PR)

- Add a small adapter-level test (or extend exporter adapter tests) that asserts Node and Python
  adapters still produce the same findings and label attachments for the same fixtures.

### Docs (in this PR)

- Update `abstractions.md` to note the shared importer-scoped adapter helper and list Node and
  Python as implementations of that shared path.

### Acceptance Criteria

- Node and Python exporter behavior remains unchanged.
- Adapter code duplication is removed in favor of the shared helper.
- Tests cover both adapters and pass.

### Risks

Adapter-specific edge cases may be lost if the helper is too generic.

### Mitigation

Keep adapter-specific hooks explicit (for example `shouldWarnMissingKindLabel`) and assert behavior
via a fixture test per language.

### Consequence of Not Implementing

Importer-scoped adapter logic remains duplicated and harder to evolve consistently.

### Downsides for Implementing

Small refactor and minor test adjustments.

### Recommendation

Implement.

---

## PR-4: Factor importer-scoped provider sync plugin scaffolding

### Description

I will extract the shared provider sync scaffolding for importer-scoped languages so Node and Python
do not duplicate the same driver wiring patterns.

### Scope & Changes

- Add a helper for importer-scoped provider sync in `build-tools/tools/buck/providers` (or `build-tools/tools/lib`) that:
  - builds `discoverLockfiles`, `parseEffectiveSetForLockfile`, and `listImporterPatchesFor`.
  - accepts language-specific parser and lockfile basenames.
- Update `build-tools/tools/buck/providers/node.ts` and `python.ts` to call the helper.
- Preserve existing behavior, including Node synthetic lockfile support and Python strict parsing.

### Tests (in this PR)

- Extend the provider sync golden tests to cover both languages after refactor.
- Add a small unit test that exercises the helper with both Node and Python configuration.

### Docs (in this PR)

- Update `abstractions.md` to note the shared importer-scoped provider sync helper and document the
  extension points (synthetic lockfiles for Node, strict parsing for Python).

### Acceptance Criteria

- Provider sync outputs are unchanged for Node and Python.
- Node synthetic lockfile behavior remains opt-in and unchanged.
- Tests cover the new helper and pass.

### Risks

Node and Python behavior could drift if the helper hides language-specific details.

### Mitigation

Keep language-specific hooks explicit and verify behavior with golden outputs for both languages.

### Consequence of Not Implementing

Importer-scoped provider sync logic remains duplicated and harder to maintain.

### Downsides for Implementing

Refactor across provider sync files and new helper tests.

### Recommendation

Implement.

---

## PR-5: Remove C++ sanitizer indirection

### Description

I will remove the thin `sanitize_to_bin_name(...)` wrapper in `build-tools/cpp/private/sanitize.bzl` and use
the canonical `lang/sanitize.bzl:sanitize_name` directly at call sites.

### Scope & Changes

- Update any C++ macros or rules that call `sanitize_to_bin_name(...)` to call `sanitize_name(...)`.
- Remove or simplify `build-tools/cpp/private/sanitize.bzl` to avoid redundant indirection.
- Keep parity tests that ensure sanitizer behavior remains unchanged.

### Tests (in this PR)

- Update `build-tools/tools/tests/cpp/sanitize-name.parity.test.ts` if needed to reference the canonical
  sanitizer directly.

### Docs (in this PR)

- Update `abstractions.md` to list only `lang/sanitize.bzl:sanitize_name` as the C++ sanitizer entry
  point.

### Acceptance Criteria

- No C++ code path uses `sanitize_to_bin_name(...)`.
- Sanitization parity tests remain green.

### Risks

Minimal; behavior should be identical.

### Mitigation

Keep the parity test in place to guard behavior.

### Consequence of Not Implementing

Unnecessary indirection remains, and the canonical entry point is less clear.

### Downsides for Implementing

Small refactor and test adjustment.

### Recommendation

Implement.
