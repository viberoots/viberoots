# Quad Alignment Plan - Close Cross-Language Wiring and Planner Drift (CPP / Go / PNPM / Python) - Part 43

This installment follows Part 42. It focuses on the abstraction leaks and duplication that still show up at the wiring and planner layers. I am not adding any PRs that are only tests or only docs. Each PR includes the tests and documentation needed for the change.

The gaps I am closing in this plan:

- The patch invalidation model still leaks into macro call sites. Macros must choose package-local versus importer-scoped wiring.
- Provider-edge realization has two implementations with subtle differences.
- Planner node inspection logic is duplicated across Go, C++, and Python planners.
- Patch map construction and patch normalization is implemented in multiple template entrypoints.

---

## PR-1: Add a unified language wiring boundary for macros and remove patch-model knowledge from call sites

### Description

I will add a single, canonical wiring entrypoint for macro authors. The entrypoint will route to the correct model based on the language contract. This removes the need for macro call sites to know whether a language is package-local or importer-scoped.

### Scope & Changes

- Add a canonical wiring entrypoint under `//build-tools/lang`:
  - New helper, for example `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)`.
  - The helper uses the language contract in `build-tools/lang/lang_contracts.bzl` to choose the wiring model.
- Refactor macro call sites:
  - Go and C++ macros use the unified entrypoint instead of package-local specific helpers.
  - Node and Python macros use the unified entrypoint instead of importer-specific helpers.
- Preserve current behavior:
  - I will keep wiring outputs identical, including provider edges, labels, and patch inputs.
- Refactor documentation as part of the PR:
  - Update `abstractions.md` and any macro cookbook pages to describe the canonical entrypoint and the removal of patch-model knowledge from call sites.
- Before refactor work, I will document the exact relocation plan in the PR description:
  - Call sites to update.
  - Any helpers to be re-exported or kept as internal primitives.

Non-goals in this PR:

- No change to importer label format or patch invalidation policy.
- No changes to provider mapping rules or exporter behavior.

### Tests (in this PR)

- Add a focused parity test that asserts the unified wiring entrypoint returns the same outputs as the current per-model helpers for:
  - a package-local case
  - an importer-scoped case
- Add or extend a non-mutation test for the unified entrypoint to ensure it does not mutate `kwargs`.
- Add a focused test that verifies importer is derived from the lockfile label when the language contract is importer-scoped.

### Docs (in this PR)

- Update `abstractions.md` to list the canonical wiring entrypoint and make the per-model helpers internal only.
- Update macro authoring guidance to describe that call sites should not choose wiring model directly.

### Acceptance Criteria

- All macro call sites use the unified wiring entrypoint.
- Call sites no longer branch on package-local versus importer-scoped wiring.
- Tests prove wiring output equivalence and non-mutation for both models.

### Risks

Moderate. This touches macro boundaries across multiple languages.

Mitigation:

- Keep behavior identical.
- Add parity tests before and after refactoring.

### Consequence of Not Implementing

Patch model knowledge remains embedded in call sites. This increases drift risk when adding new macros or languages.

### Downsides for Implementing

Refactor churn across multiple macro entrypoints and new tests to maintain.

### Recommendation

Implement.

---

## PR-2: Consolidate provider-edge realization into a single helper and remove duplicate implementations

### Description

Provider-edge realization is currently duplicated across package-local and importer-scoped wiring helpers. I will consolidate it into one helper that supports list and dict-shaped inputs. This removes duplication and makes provider wiring behavior consistent across languages.

### Scope & Changes

- Create a single provider-edge helper in `build-tools/lang/provider_edges.bzl` that:
  - accepts list or dict-shaped `srcs` and `deps`
  - merges provider edges deterministically
  - keeps the same ordering and filtering behavior as today
- Update package-local and importer-scoped wiring helpers to call the unified helper.
- Remove or deprecate duplicate edge-merge logic in `build-tools/lang/importer_wiring_primitives.bzl`.
- Document the new canonical helper and its shape requirements in `abstractions.md`.
- Before refactor work, I will document the relocation plan in the PR description:
  - which functions are removed or replaced
  - any call sites that require shape normalization

Non-goals in this PR:

- No change to provider naming or provider mapping generation.
- No change to patch inclusion rules for Node or Python.

### Tests (in this PR)

- Add tests that cover both shapes:
  - list-shaped `deps`
  - dict-shaped `srcs` with provider edges
- Extend an existing provider wiring test to ensure the unified helper preserves ordering.

### Docs (in this PR)

- Update `abstractions.md` to point to the single provider-edge helper and describe supported shapes.

### Acceptance Criteria

- Only one provider-edge helper is used by both wiring models.
- Tests confirm behavior parity and order stability.

### Risks

Low to moderate. Ordering changes or edge placement could alter action keys.

Mitigation:

- Keep ordering identical to current helpers.
- Add explicit tests for ordering and edge placement.

### Consequence of Not Implementing

Provider edge behavior can drift between wiring models. This makes cross-language behavior harder to reason about and enforce.

### Downsides for Implementing

Some refactor churn and a small set of new tests.

### Recommendation

Implement.

---

## PR-3: Extract planner node inspection helpers and remove duplicated logic in Go, C++, and Python planners

### Description

Planner files duplicate logic for language and kind detection. I will extract a shared planner helper library so all planners use the same inspection rules.

### Scope & Changes

- Add shared node inspection helpers in `build-tools/tools/nix/planner/lib.nix`:
  - language detection by rule type and labels
  - kind inference with consistent behavior
  - normalization helpers for target labels if needed for planner logic
- Update these planners to use the shared helpers:
  - `build-tools/tools/nix/planner/go.nix`
  - `build-tools/tools/nix/planner/cpp.nix`
  - `build-tools/tools/nix/planner/python-core.nix`
- Keep all behavior stable. No changes to planner outputs.
- Before refactor work, I will document relocation points for the helper functions in the PR description:
  - which helper functions move
  - which call sites are updated

Non-goals in this PR:

- No change to planner templates or target selection rules.
- No changes to exporter behavior.

### Tests (in this PR)

- Add a unit-level test that exercises the shared planner helpers against a small set of synthetic nodes.
- Extend a planner output test to verify no output diff for one target per language.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` to reference the shared planner helper library and to state that planners should not re-implement node inspection.

### Acceptance Criteria

- All planner files use the shared helper library for node inspection.
- Planner outputs remain unchanged for representative fixtures.
- Tests prove helper behavior for Go, C++, and Python nodes.

### Risks

Low. This is a refactor of helper logic if parity is maintained.

Mitigation:

- Keep helper logic copied directly from existing planners.
- Add output parity tests.

### Consequence of Not Implementing

Planner behavior drifts and must be kept in sync manually across three files.

### Downsides for Implementing

Minor refactor work and a small set of tests.

### Recommendation

Implement.

---

## PR-4: Unify patch map construction and normalization across language templates

### Description

Patch map construction is implemented at multiple entrypoints with slightly different normalization rules. I will add a single helper surface for patch map construction and use it across Go, C++, and Python templates.

### Scope & Changes

- Add a single patch map helper in `build-tools/tools/nix/lib/lang-helpers.nix` that:
  - accepts patch directories
  - supports language-specific version normalization via an injected normalizer
  - supports store materialization where required by Python
- Update templates to use the shared helper:
  - `build-tools/tools/nix/templates/go.nix`
  - `build-tools/tools/nix/templates/cpp*.nix`
  - `build-tools/tools/nix/templates/python*.nix`
- Keep the patch filename decoding contract unchanged.
- Before refactor work, I will document how existing helpers are replaced in the PR description:
  - helper names removed or merged
  - any normalization rules preserved per language

Non-goals in this PR:

- No changes to patch naming or patch discovery rules.
- No changes to patch inclusion policies for Node or Python.

### Tests (in this PR)

- Add a parity test that compares patch map construction across languages for a fixed set of patch filenames.
- Extend existing patch filename decoding tests to verify the shared helper uses the canonical decoding logic.

### Docs (in this PR)

- Update `abstractions.md` to list the canonical patch map helper and describe language-specific normalization hooks.

### Acceptance Criteria

- All templates use the shared patch map helper.
- Patch map outputs remain stable for existing fixtures.
- Tests lock the shared helper and the per-language normalization rules.

### Risks

Low to moderate. Patch map changes could affect derivation inputs.

Mitigation:

- Keep helper behavior identical to current implementations.
- Add parity tests that compare current and new outputs.

### Consequence of Not Implementing

Patch map behavior will continue to drift across languages. This makes patch invalidation harder to reason about.

### Downsides for Implementing

Refactor work across multiple templates and new tests to maintain.

### Recommendation

Implement.

---

## Rollout and Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR-1 first. It provides the unified macro wiring surface.
2. PR-2 second. It unifies provider edges behind the shared wiring surface.
3. PR-3 third. It refactors planner helpers without changing outputs.
4. PR-4 last. It unifies patch map construction after wiring and planner helpers are stable.

---

## Verification and Backout Strategy

Each PR includes:

- targeted tests that verify behavior parity for the changed surface
- documentation updates that use the canonical contract vocabulary

Backout strategy:

- PR-1 can be reverted by restoring per-model wiring helpers in macro call sites while keeping parity tests for future drift detection.
- PR-2 can be reverted by reintroducing the previous provider-edge helper split if a regression is found.
- PR-3 can be reverted by restoring planner-local helper functions, keeping the planner output tests as regressions.
- PR-4 can be reverted by restoring template-local patch map construction, keeping the parity tests to catch drift.
