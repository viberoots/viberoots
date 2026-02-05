## Training Plan 9. C++ linking shared-lib and closure coverage

This plan closes the remaining gaps from the C++ linking review and our follow up decisions. I keep each PR small and focused. Each PR adds tests and updates documentation for the behavior it changes. I do not create docs only or tests only PRs.

## Prerequisites (must already be true)

This plan assumes the shared link intent contract and current C++ linking phases are in place:

- `build-tools/tools/nix/planner/link-closure.nix` exists and is used by the C++ planner
- C++ macros accept `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides`
- Exporter surfaces link intent attributes in the graph
- Shared library template `cppSharedLib` exists and builds a `.so` or `.dylib`

---

## PR-1: Shared libs link their own link_deps with explicit closure

### Description

This PR makes shared C++ libraries link their own declared `link_deps`. It uses the producer's `link_closure` to decide whether to include only direct deps or the transitive closure. This keeps the producer responsible for its own link requirements and improves DX for consumers.

### Scope & Changes

This PR makes the following changes:

- Update `build-tools/tools/nix/planner/cpp.nix` so `cppSharedLib` receives `repoCppLibPkgsFor` when `link_mode="shared"`, not only header packages.
- Apply the producer's `link_closure` to shared lib `link_deps` using the existing resolver, just like consumers.
- Keep consumer semantics unchanged. Consumers still decide their own `link_closure` for their own `link_deps`.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.shared-lib.links-direct-link-deps.builds.test.ts`
  - define a shared lib with a direct `link_dep` and verify it builds without unresolved symbols
- `build-tools/tools/tests/cpp/cpp.shared-lib.link-closure.transitive.links-deps.builds.test.ts`
  - define a shared lib whose `link_deps` include another lib with its own `link_deps`
  - set `link_closure="transitive"` and verify build success and deterministic order

### Docs (in this PR)

I update documentation to make producer behavior explicit:

- Update `build-tools/docs/cpp-linking.md` to state that shared libs link their own `link_deps` and honor their own `link_closure`.

### Acceptance Criteria

The following must be true:

- A shared C++ library links its direct `link_deps` without consumer restatement.
- A shared C++ library honors `link_closure="transitive"` for its own `link_deps`.
- The new tests fail if shared libs ignore their `link_deps`.

### Risks

Low. This broadens the link inputs for shared libs and may surface missing or misordered deps.

### Consequence of Not Implementing

Shared libraries can build with unresolved symbols or require consumers to guess producer link requirements. That is error prone and inconsistent with the explicit link intent model.

### Downsides for Implementing

Shared libraries may link more inputs than before, which can increase build time slightly.

### Recommendation

Implement to make shared libs self contained and consistent with explicit link intent.

---

## PR-2: Per kind transitive closure coverage for addon and test

### Description

This PR adds per kind coverage for transitive link closure. It covers Node addons and C++ tests, which are required by the completion criteria.

### Scope & Changes

This PR makes the following changes:

- Add a Node addon test that uses `link_closure="transitive"` and relies on a nested C++ lib `link_deps` chain.
- Add a C++ test case that uses `link_closure="transitive"` and links a nested library chain.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.addon.link-closure.transitive.follows-link-deps.build-and-load.test.ts`
  - addon links `//projects/libs/core:core` and `core` links `//projects/libs/support:support`
  - addon sets `link_closure="transitive"` and loads successfully
- `build-tools/tools/tests/cpp/cpp.test.link-closure.transitive.follows-link-deps.build-and-run.test.ts`
  - C++ test links `//projects/libs/core:core` with transitive closure and runs

### Docs (in this PR)

I update documentation to reflect per kind coverage:

- Update `build-tools/docs/cpp-linking.md` to mention that transitive closure is supported and tested for bin, addon, and test targets.

### Acceptance Criteria

The following must be true:

- A Node addon can rely on transitive `link_deps` with `link_closure="transitive"`.
- A C++ test can rely on transitive `link_deps` with `link_closure="transitive"`.
- The new tests fail if transitive closure is not applied for addons or tests.

### Risks

Low. These are coverage additions for existing functionality.

### Consequence of Not Implementing

The completion criteria in `build-tools/docs/cpp-linking.md` remains unverified for addons and tests.

### Downsides for Implementing

Adds two more integration tests that build and run small native artifacts.

### Recommendation

Implement to close the per kind coverage gap.

---

## PR-3: Link intent overlap tolerance and override normalization coverage

### Description

This PR documents and tests that overlap between `link_deps` and `header_deps` is allowed and handled deterministically. It also adds coverage for duplicate key detection in `link_closure_overrides` after normalization.

### Scope & Changes

This PR makes the following changes:

- Keep overlap behavior forgiving and deterministic. No validation error is added.
- Add a test that uses an overlapping entry in `link_deps` and `header_deps` and proves it builds.
- Add a test that confirms duplicate `link_closure_overrides` keys after normalization fail fast.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.link-intent.overlap.link-and-header-deps.allowed.builds.test.ts`
  - define a target where one dep appears in both `link_deps` and `header_deps`
  - verify the build succeeds and link inputs are deterministic
- `build-tools/tools/tests/cpp/cpp.link-closure.overrides.duplicate-keys.normalized.fails.test.ts`
  - define `link_closure_overrides` with keys that normalize to the same label
  - verify the planner fails with the duplicate keys error

### Docs (in this PR)

I update documentation to match the decision:

- Update `build-tools/docs/cpp-linking.md` to state that overlap between `link_deps` and `header_deps` is allowed and handled by deterministic union.
- Update `build-tools/docs/cpp-linking.md` to restate that duplicate keys after normalization in `link_closure_overrides` are rejected.

### Acceptance Criteria

The following must be true:

- A target with overlapping `link_deps` and `header_deps` builds successfully.
- Duplicate normalized `link_closure_overrides` keys fail fast with a clear error.
- The new tests fail if overlap is rejected or duplicate keys are not detected.

### Risks

Low. This is test and documentation alignment with existing behavior.

### Consequence of Not Implementing

We keep a spec gap where the documented behavior does not match the intended tolerance, and the override normalization error lacks coverage.

### Downsides for Implementing

Adds two more tests to the C++ suite.

### Recommendation

Implement to align documentation with the agreed behavior and lock in the edge case coverage.
