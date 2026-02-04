# Linking Plan — Phase 0 (shared primitives + graph export)

This document is a development plan to implement **Phase 0** from `linking-roadmap.md`.

Format policy:

- This is a list of PRs.
- Each PR includes its own tests and documentation updates (no tests-only PRs, no docs-only PRs).
- No functionality lands without tests in the same PR.
- Structure mirrors `quad-alignment-42.md`.

## PR-1: Add a shared Starlark “link intent” helper and prove it works via cquery-based tests

### Description

We want a single, deterministic convention for the macro-level intent lists used by:

- native C++ linking (`cpp-linking.md`)
- Wasm linking (`build-tools/docs/wasm-linking.md`)
- Python extension modules (`build-tools/docs/python-extension-design.md`)

Phase 0 introduces the shared macro semantics:

- deterministic union: `deps := deps ∪ link_deps ∪ header_deps`
- optional override validation: keys in `link_closure_overrides` must appear in `link_deps`

The goal is to implement this once in a shared helper surface and lock the behavior with tests, so later language macros can adopt it without re-implementing list union and validation logic.

### Scope & Changes

- Add Starlark helper(s) under the canonical shared surface:
  - Preferred: `//build-tools/lang:defs_common.bzl` (since many macros already load this).
  - If we want tighter SoC: add `build-tools/lang/link_intent.bzl` and re-export from `defs_common.bzl`.

- Implement helpers (names illustrative):
  - `merge_link_intent_deps(deps, link_deps, header_deps) -> list[str]`:
    - deterministic union (dedupe + stable ordering)
  - `validate_link_closure_overrides(link_deps, link_closure_overrides)`:
    - fail fast if override keys are not present in `link_deps`

- Add a tiny “probe macro” used only in tests (kept under `//build-tools/lang/` so it does not become an accidental public surface) that:
  - accepts `deps`, `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`
  - calls `merge_link_intent_deps` and `validate_link_closure_overrides`
  - emits a simple rule whose `deps` attribute can be inspected via `buck2 cquery --output-attributes=deps`

Notes on reuse (avoid reinventing):

- Reuse the repo’s existing deterministic list merge helpers if present in `//build-tools/lang:defs_common.bzl` (or adjacent files) rather than adding new ad-hoc dedupe/sort logic.
- Match the “single deps merge point” convention already documented in `docs/handbook/conventions.md`.

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/lang/` (one test per file) that:

- `build-tools/tools/tests/lang/link-intent.merges-deps.deterministic.cquery.test.ts`
  - creates a temp repo with the probe macro
  - defines a target where `deps`, `link_deps`, and `header_deps` overlap
  - asserts cquery sees exactly the union, deterministically ordered

- `build-tools/tools/tests/lang/link-intent.overrides.must-be-in-link-deps.fails-fast.test.ts`
  - creates a temp repo where `link_closure_overrides` references a dep not in `link_deps`
  - asserts the build/analysis fails with a targeted error message

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` (or a small handbook page if preferred) to state:
  - what `link_deps` and `header_deps` mean at macro surfaces
  - that macros must compute `deps := deps ∪ link_deps ∪ header_deps`
  - the override validation rule

### Acceptance Criteria

- Shared helper(s) exist under `//build-tools/lang` and are used by at least one macro in-tree (the test probe macro is sufficient).
- Tests prove:
  - deterministic union behavior
  - override validation fails fast
- Documentation describes the macro-level contract in one place.

### Risks

Low. This PR adds helpers and test-only call sites. It should not change behavior of existing macros.

### Consequence of Not Implementing

Each language would re-implement link-intent list merging and override validation differently, creating drift.

### Downsides for Implementing

Adds a small helper surface, but it centralizes policy we will otherwise duplicate.

### Recommendation

Implement.

---

## PR-2: Add a shared Nix planner “link closure” resolver and lock determinism with Nix eval tests

### Description

Phase 0 also needs a planner-level primitive that resolves the link closure deterministically:

- default `link_closure = direct|transitive`
- optional per-dep overrides (`link_closure_overrides`)
- traversal over the **link graph** (follow `link_deps`, not general `deps`)

This must be shared across:

- C++ native linking planner logic
- Go TinyGo Wasm linking planner logic
- Python extension module planner logic (later)

### Scope & Changes

- Add `build-tools/tools/nix/planner/link-closure.nix` implementing a pure function (shape illustrative):
  - `resolveLinkClosure = {`
    - `byName` (node map),
    - `linkDepsOf` (function),
    - `roots` (list),
    - `defaultClosure` (`"direct"` or `"transitive"`),
    - `overrides` (attrset mapping dep -> mode),
    - `}` → ordered unique list of resolved deps

- Keep logic tiny and deterministic:
  - stable traversal order
  - include each node once
  - fail fast on unknown closure mode

- Do not integrate it into language planners in this PR beyond a minimal “smoke integration” helper call used only in tests.
  - The first real integration will happen in Phase 1 (C++) and Phase 2 (Wasm), but Phase 0 requires the primitive to exist and be verified.

Notes on reuse:

- Reuse existing normalization helpers from `build-tools/tools/nix/planner/lib.nix` where appropriate (for label normalization).
- Keep this helper pure; do not read filesystem.

### Tests (in this PR)

Add zx tests under `build-tools/tools/tests/nix/` that validate the function via `nix eval` in a temp repo:

- `build-tools/tools/tests/nix/nix.link-closure.direct-and-transitive.eval.test.ts`
  - evaluates `resolveLinkClosure` against a small in-memory graph fixture
  - asserts output lists are stable and match expected for:
    - direct mode
    - transitive mode

- `build-tools/tools/tests/nix/nix.link-closure.overrides.eval.test.ts`
  - same graph, default direct
  - override one dep to transitive and assert mixed behavior is deterministic

These tests must use the repo’s existing testing harness conventions (external timeout policy, zx, no network).

### Docs (in this PR)

- Update `linking-roadmap.md` and/or `cpp-linking.md` / `build-tools/docs/wasm-linking.md` to reference:
  - `build-tools/tools/nix/planner/link-closure.nix` as the canonical planner primitive
  - its deterministic traversal rules

### Acceptance Criteria

- `build-tools/tools/nix/planner/link-closure.nix` exists and is pure/deterministic.
- Tests prove direct/transitive and overrides behavior.
- Docs reference the helper as the canonical planner-level closure resolver.

### Risks

Low. This is new helper code and eval-only tests.

### Consequence of Not Implementing

Each language planner would implement its own closure logic, which will drift and be hard to keep consistent.

### Downsides for Implementing

Adds one more Nix module, but it reduces future duplication.

### Recommendation

Implement.

---

## PR-3: Exporter attribute surface — ensure link intent attrs are exported, and lock it with an exporter test fixture

### Description

Phase 0 requires that when targets start using the new intent attributes, they actually appear in `build-tools/tools/buck/graph.json` so planners can consume them.

Today, `build-tools/tools/buck/export-graph.ts` exports a fixed set of output attributes. We need to extend it to include:

- `link_deps`
- `header_deps`
- `link_closure`
- `link_closure_overrides`

This PR should not depend on any one language adopting the attrs yet. It should prove the exporter can carry these fields when they exist.

### Scope & Changes

- Extend exporter attribute list(s):
  - `build-tools/tools/buck/export-graph.ts`
  - `build-tools/tools/buck/export-inline.ts` (if it has its own attribute list)

- Add the intent attributes to the `--output-attributes` list.

- Ensure merge behavior remains monotonic and deterministic:
  - do not delete unknown fields
  - do not reorder unrelated fields

Notes on reuse:

- Reuse existing Composite Graph API usage and tests (do not introduce a parallel graph reader).

### Tests (in this PR)

Add a zx test under `build-tools/tools/tests/exporter/`:

- `build-tools/tools/tests/exporter/exporter.exports.link-intent-attrs.test.ts`
  - create a temp repo with a tiny custom Starlark rule that accepts the new attrs (because built-in rules do not accept arbitrary attributes)
  - define a target with `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`
  - run the exporter and assert `graph.json` contains these fields with the expected values

This test ensures the exporter change is necessary and sufficient.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` (or a linking section) to list the new exported fields as part of the planner contract.

### Acceptance Criteria

- Exporter includes the new attrs in its output attribute list.
- Test proves the attrs appear in `graph.json` for a target that defines them.
- Docs reflect the exported attribute contract.

### Risks

Low. Exporting additional attrs should not change existing consumers as long as JSON schema is tolerant of additional fields.

### Consequence of Not Implementing

We could implement macros and planner logic but still not observe the intent attributes in the exported graph, causing silent misbehavior.

### Downsides for Implementing

Small exporter churn and one new exporter test.

### Recommendation

Implement.
