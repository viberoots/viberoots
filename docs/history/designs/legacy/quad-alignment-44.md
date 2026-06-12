# Quad Alignment Plan - Close Remaining Cross-Language Gaps (CPP / Go / PNPM / Python) - Part 44

#

# This plan targets the remaining gaps identified in the current repo state.

# Each PR includes code, tests, and documentation updates together.

#

# Scope: provider-edge wiring, planner node inspection parity, patch-map helper defaults,

# and exporter classification registry consolidation.

#

# Non-goals: no standalone docs-only or tests-only PRs.

## PR-1: Make provider-edge realization use one canonical entrypoint

### Description

I will remove the remaining split between `realize_provider_edges(...)` and `merge_provider_edges(...)`
by routing package-local wiring through the same canonical helper used by importer-scoped wiring.

### Scope & Changes

- Update `build-tools/lang/package_local_wiring.bzl` to call the canonical helper (`merge_provider_edges(...)`)
  instead of `realize_provider_edges(...)`.
- Keep ordering and dedupe behavior identical to current package-local wiring.
- Keep dict-safe behavior supported for importer-scoped wiring (no behavior change).
- Update `build-tools/docs/abstractions.md` to list a single canonical provider-edge helper for all wiring models.

### Tests (in this PR)

- Extend the existing provider-edges probes to cover package-local wiring output parity.
- Add a probe that asserts provider-edge ordering matches the previous package-local behavior.

### Docs (in this PR)

- Update the provider-edge section in `build-tools/docs/abstractions.md` to point to the canonical helper and
  to document the supported input shapes (list and dict-safe).

### Acceptance Criteria

- Package-local wiring uses the canonical helper.
- Provider-edge ordering and dedupe behavior are unchanged for existing targets.
- Tests prove parity for package-local and importer-scoped wiring.

### Risks

Ordering drift could change action keys.

### Mitigation

Add explicit ordering assertions in tests and compare with baseline probe outputs.

### Consequence of Not Implementing

Provider-edge behavior can drift between wiring models, increasing cross-language inconsistency.

### Downsides for Implementing

Small refactor churn across wiring helpers and test updates.

### Recommendation

Implement.

---

## PR-2: Unify planner `kindOf` and common planner helpers

### Description

I will centralize planner node inspection logic so `kindOf` and common helpers are shared
across Go, C++, and Python planners. This removes duplicated ordering rules and reduces drift risk.

### Scope & Changes

- Add a shared `kindOf` helper in `build-tools/tools/nix/planner/lib.nix` that accepts a language-specific
  configuration (label priorities, rule-type mapping, planner-stub rules).
- Update:
  - `build-tools/tools/nix/planner/go.nix`
  - `build-tools/tools/nix/planner/cpp.nix`
  - `build-tools/tools/nix/planner/python-core.nix`
    to call the shared helper instead of local implementations.
- Move shared helpers like `dedupePreserveOrder` into `build-tools/tools/nix/planner/lib.nix` and reuse them.
- Update `build-tools/docs/build-system-design.md` to state that planners must not re-implement `kindOf`.

### Tests (in this PR)

- Add a focused unit test for the shared `kindOf` helper with a small matrix of synthetic nodes.
- Extend an existing planner integration test to assert no diff in outputs for one target per language.

### Docs (in this PR)

- Update `build-tools/docs/build-system-design.md` and `build-tools/docs/abstractions.md` to reference the shared planner helper
  and state that per-language planners should not define their own `kindOf`.

### Acceptance Criteria

- No planner defines `kindOf` locally.
- Shared helper produces the same outputs for representative targets.
- Tests verify parity and shared behavior.

### Risks

Incorrect ordering in the shared helper could change target routing.

### Mitigation

Preserve existing language-specific ordering in the configuration passed to the helper
and validate with integration tests.

### Consequence of Not Implementing

Planner inspection logic continues to drift and requires manual sync.

### Downsides for Implementing

Moderate refactor and coordination across planner files.

### Recommendation

Implement.

---

## PR-3: Add a Python patch-map helper with language defaults

### Description

I will reduce repeated Python patch-map boilerplate by adding a language-specific helper
that encodes the Python defaults (normalize version and store materialization).

### Scope & Changes

- Add a helper to `build-tools/tools/nix/lib/lang-helpers.nix`, for example:
  - `pythonPatchesMapFromDirs(...)` or `patchesMapFromDirsForLang("python", ...)`
- Update Python templates to use the helper:
  - `build-tools/tools/nix/templates/python.nix`
  - `build-tools/tools/nix/templates/python/wasm.nix`
  - `build-tools/tools/nix/templates/python/wasm-site.nix`
- Keep patch filename decoding and normalization rules unchanged.

### Tests (in this PR)

- Add a small parity test to assert the new helper matches the previous inline logic
  for a representative patch filename set.

### Docs (in this PR)

- Update `build-tools/docs/abstractions.md` to reference the Python patch-map helper and its defaults.

### Acceptance Criteria

- Python templates no longer inline normalize/materialize parameters.
- Patch map outputs remain unchanged for existing fixtures.
- Tests pass and show parity.

### Risks

Patch map changes could affect derivation inputs.

### Mitigation

Use parity tests and compare against the previous helper output.

### Consequence of Not Implementing

Python patch map defaults continue to be duplicated and error-prone.

### Downsides for Implementing

Minor refactor and small test addition.

### Recommendation

Implement.

---

## PR-4: Centralize exporter classification config

### Description

I will remove duplicated classification rules across exporter adapters by introducing
a shared registry of language classification config.

### Scope & Changes

- Add a registry under `build-tools/tools/buck/exporter/lang/` that defines:
  - `looksLike` patterns
  - rule-type prefixes
  - language labels
  - guidance strings
- Update adapters to consume the registry rather than re-implementing classification rules:
  - `build-tools/tools/buck/exporter/lang/go.ts`
  - `build-tools/tools/buck/exporter/lang/cpp.ts`
  - `build-tools/tools/buck/exporter/lang/node.ts`
  - `build-tools/tools/buck/exporter/lang/python.ts`
- Keep behavior identical, including Node importer-scoped validation behavior.

### Tests (in this PR)

- Add unit tests that assert registry entries map to the same validation outputs
  as the current adapter behavior for a representative node set.

### Docs (in this PR)

- Update `build-tools/docs/abstractions.md` or exporter doc pages to state that adapters must use the registry.

### Acceptance Criteria

- Adapters delegate classification logic to the registry.
- Validation outputs are unchanged for known fixtures.
- Tests enforce registry parity.

### Risks

Small changes in look-like rules could change validation warnings.

### Mitigation

Build tests that compare the old and new outputs using controlled fixtures.

### Consequence of Not Implementing

Classification rules continue to diverge across adapters.

### Downsides for Implementing

Minor refactor and new tests.

### Recommendation

Implement.
