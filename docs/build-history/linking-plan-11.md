# Training Plan 11. C++ link intent validation for tests

This plan closes the remaining gap from the C++ linking assessment and aligns the test macro behavior with the link intent contract. I keep each PR small and focused. Each PR adds tests and updates documentation for the behavior it changes. I do not create docs only or tests only PRs.

## Prerequisites (must already be true)

I rely on the existing shared link intent surface and the current C++ planner wiring. This should already be true:

- `tools/nix/planner/link-closure.nix` exists and is used by the C++ planner
- C++ macros accept `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides`
- Exporter surfaces link intent attributes in the graph
- The C++ planner enforces `link_closure_overrides` validity during evaluation

---

## PR-1: Enforce link_closure_overrides validation for nix_cpp_test

### Description

This PR makes `nix_cpp_test` validate `link_closure_overrides` at the macro layer, matching the behavior of other C++ macros and the shared link intent contract.

### Scope & Changes

This PR makes the following changes:

- Update `cpp/defs.bzl` so `nix_cpp_test` calls `validate_link_closure_overrides` on `link_deps`
- Keep the deterministic deps union rule unchanged
- Keep planner behavior unchanged and rely on the macro validation for early feedback

### Tests (in this PR)

I add one zx test:

- `tools/tests/cpp/cpp.test.link-closure.overrides.must-be-in-link-deps.fails-fast.test.ts`
  - define a `nix_cpp_test` that sets `link_closure_overrides` with a key not in `link_deps`
  - assert that Buck macro evaluation fails fast with the expected error

### Docs (in this PR)

I update documentation to reflect macro level validation:

- Update `cpp-linking.md` to state that all C++ macros, including `nix_cpp_test`, validate `link_closure_overrides` keys against `link_deps`

### Acceptance Criteria

The following must be true:

- `nix_cpp_test` rejects `link_closure_overrides` keys that are not present in `link_deps`
- Existing C++ macros keep the same link intent behavior
- The new test fails before planner evaluation and passes when the override keys are valid

### Risks

Low. The change only adds macro level validation that the planner already enforces.

### Consequence of Not Implementing

`nix_cpp_test` remains inconsistent with the link intent contract, and invalid overrides fail later with planner errors.

### Downsides for Implementing

A small amount of additional macro validation logic and one new test.

### Recommendation

Implement to keep the C++ macro surface consistent and to fail fast on invalid overrides.
