# Training Plan 10. C++ linking semantics and planner compliance

This plan closes the remaining gaps from the C++ linking assessment and aligns behavior with the documented intent. I keep each PR small and focused. Each PR adds tests and updates documentation for the behavior it changes. I do not create docs only or tests only PRs.

## Prerequisites (must already be true)

This plan assumes the shared link intent contract and current C++ linking phases are in place:

- `tools/nix/planner/link-closure.nix` exists and is used by the C++ planner
- C++ macros accept `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides`
- Exporter surfaces link intent attributes in the graph
- Shared library template `cppSharedLib` exists and builds a `.so` or `.dylib`

---

## PR-1: Enforce header-only semantics for header_deps and keep the planner under 250 lines

### Description

This PR makes `header_deps` behave as header-only include inputs even when the dep is a C++ library. It also splits the C++ planner into smaller modules so each file stays under 250 lines as required by our methodology.

### Scope & Changes

This PR makes the following changes:

- Update `tools/nix/planner/cpp.nix` to pass header-only packages for `header_deps` even when the dep is a library.
- Ensure link inputs are derived only from `link_deps`, not from `header_deps`.
- Refactor `tools/nix/planner/cpp.nix` into smaller helper modules so each file is within the 250 line limit.
- Keep existing link intent overlap behavior unchanged. If a dep is in both lists, it remains a link dep and a header dep, but header-only handling applies only to the header list.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/cpp/cpp.header-deps.library.does-not-link.test.ts`
  - define a C++ library with headers and a binary that lists it only in `header_deps`
  - assert the binary build log does not include `-l<lib>` for that dep
- `tools/tests/cpp/cpp.header-deps.library.still-compiles.test.ts`
  - compile a binary that includes the library headers and uses inline or header-only constructs
  - prove the build succeeds without link inputs for that library

### Docs (in this PR)

I update documentation to make header-only semantics explicit and remove ambiguity:

- Update `cpp-linking.md` to state that `header_deps` never add link inputs, even if the dep is a C++ library target.
- Update `cpp-linking.md` to clarify that overlap is allowed, but link inputs come only from `link_deps`.

### Acceptance Criteria

The following must be true:

- A library listed only in `header_deps` never contributes `-l` flags to a consumer.
- A consumer can compile against library headers via `header_deps` without linking that library.
- The refactored planner files remain under 250 lines each and behavior remains unchanged outside header-only semantics.

### Risks

Low. This narrows link inputs and can expose targets that were accidentally relying on header-only deps for linking.

### Consequence of Not Implementing

`header_deps` continues to leak link inputs, which contradicts the explicit intent model and makes behavior harder to reason about.

### Downsides for Implementing

Some targets may need to move dependencies from `header_deps` to `link_deps` once the behavior is enforced.

### Recommendation

Implement to align the planner with the explicit intent model and the methodology file size constraints.

---

## PR-2: Resolve link intent documentation inconsistency and lock in overlap behavior

### Description

This PR resolves the remaining inconsistency in `cpp-linking.md` about overlap between `link_deps` and `header_deps`, and adds a targeted test that reflects the clarified behavior.

### Scope & Changes

This PR makes the following changes:

- Remove the contradictory statement that `link_deps` and `header_deps` must be disjoint.
- Keep the existing deterministic union behavior and make it explicit as the contract.
- Add a focused test that proves overlap builds and does not change link order determinism.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/cpp/cpp.link-intent.overlap.link-and-header-deps.allowed.builds.test.ts`
  - define a target where one dep appears in both lists
  - verify the build succeeds and link order is deterministic

### Docs (in this PR)

I update documentation to match the final decision:

- Update `cpp-linking.md` to remove the disjoint requirement and describe overlap as allowed.
- Update `cpp-linking.md` to restate that the deterministic union rule applies to all three lists.

### Acceptance Criteria

The following must be true:

- The documentation contains no conflicting statements about overlap.
- A target with overlap builds successfully and preserves deterministic ordering.

### Risks

Low. This is a documentation and coverage alignment with existing behavior.

### Consequence of Not Implementing

The spec remains ambiguous and contradicts the current implementation.

### Downsides for Implementing

Adds a small test to the C++ suite.

### Recommendation

Implement to make the documentation consistent with behavior and maintain test coverage.
