## Training Plan 8. C++ linking gap closures

This plan closes the gaps found in the C++ linking review. I keep each PR small and self contained. Each PR adds tests and updates documentation for the functionality it changes. There are no docs only or tests only PRs.

## Prerequisites (must already be true)

This plan assumes the shared link intent contract and C++ linking phases are already in place:

- `build-tools/tools/nix/planner/link-closure.nix` exists and is used by the C++ planner
- C++ macros accept `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides`
- Exporter surfaces link intent attributes in the graph

---

## PR-1: C++ per-dep link closure overrides are wired for bin lib addon

### Description

This PR makes `link_closure_overrides` effective for C++ binaries, libraries, and addons. It closes the gap where overrides are accepted at the macro surface but dropped before the planner consumes them.

### Scope & Changes

This PR makes the following changes:

- Wire `link_closure_overrides` through `build-tools/cpp/defs.bzl` into `cpp_nix_build` for `nix_cpp_binary`, `nix_cpp_library`, and `nix_cpp_node_addon`.
- Add a small macro level validation that rejects `link_closure_overrides` keys not present in `link_deps` for C++ macros, mirroring the shared contract.
- Update the C++ planner tests to cover the wiring on a C++ binary case that relies on overrides.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.link-closure.overrides.apply.deterministic.test.ts`
  - update or extend to ensure the binary uses the override to pull transitive deps in the expected order via the macro path, not only the planner direct graph path

### Docs (in this PR)

I update documentation to make the override behavior explicit for C++ macros:

- Update `cpp-linking.md` to state that `link_closure_overrides` is consumed by `nix_cpp_binary`, `nix_cpp_library`, and `nix_cpp_node_addon` and must reference only `link_deps`.

### Acceptance Criteria

The following must be true:

- A C++ binary that uses `link_closure_overrides` pulls the expected transitive deps.
- Overrides are rejected when they reference a label that is not in `link_deps`.
- The updated test fails if overrides are not wired through the macro path.

### Risks

Low. This is a wiring and validation change.

### Consequence of Not Implementing

Per-dep overrides continue to be ignored for C++ bin lib addon, and callers can misconfigure overrides without feedback.

### Downsides for Implementing

Adds a small validation surface that must remain consistent across languages.

### Recommendation

Implement to restore the link intent contract for C++ macros.

---

## PR-2: C++ libraries consume header_deps during compilation

### Description

This PR ensures C++ libraries can include headers from `nix_cpp_headers` via `header_deps`. It closes the gap where the planner ignores `header_deps` for native library compilation.

### Scope & Changes

This PR makes the following changes:

- Update `build-tools/tools/nix/planner/cpp.nix` to pass `repoCppHeaderPkgsFor` into `cppLib` and `cppSharedLib` inputs so headers are available during lib compilation.
- Add a C++ test where a library includes a header from a header only target via `header_deps`.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.lib.header-deps.uses-cpp-headers.compiles.test.ts`
  - define a `nix_cpp_library` that includes a header from `nix_cpp_headers`
  - build via the planner and assert compilation succeeds

### Docs (in this PR)

I update documentation to reflect library level header deps:

- Update `cpp-linking.md` to state that `header_deps` are applied to C++ libraries during their own compilation.

### Acceptance Criteria

The following must be true:

- A C++ library that uses `header_deps` compiles without manual include path wiring.
- The new test fails if header deps are not passed into library compilation.

### Risks

Low. This extends an existing input list.

### Consequence of Not Implementing

C++ libraries cannot safely use header only deps without manual include flags, which violates the link intent contract.

### Downsides for Implementing

Slightly broader input set for library builds.

### Recommendation

Implement to align library compilation with the documented header deps semantics.

---

## PR-3: Shared C++ libs for Node addons are tested

### Description

This PR adds coverage for Node addons that link shared C++ libraries. It does not change behavior unless a test reveals a missing wiring detail.

### Scope & Changes

This PR makes the following changes:

- Add a test that builds a `nix_cpp_node_addon` that depends on a shared `nix_cpp_library`, then loads the addon with Node to verify runtime linking works.
- If the test fails due to missing runtime path handling, update the C++ addon template or packaging to include shared library paths in rpath. Keep the change minimal and deterministic.

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/cpp/cpp.addon.links-shared-lib.via-link-deps.build-and-load.test.ts`
  - build a shared lib and a Node addon that links it via `link_deps`
  - load the addon and assert it returns the shared symbol result

### Docs (in this PR)

I update documentation to describe shared linking for addons:

- Update `cpp-linking.md` to include a shared lib addon example and note any runtime constraints.

### Acceptance Criteria

The following must be true:

- A Node addon that links a shared C++ library loads and runs on supported platforms.
- The new test fails if shared linkage is not wired correctly.

### Risks

Medium. Runtime loader behavior can be platform sensitive, and rpath policy might need a small adjustment.

### Consequence of Not Implementing

Shared C++ libraries for Node addons remain undocumented and untested, which risks runtime failures.

### Downsides for Implementing

Adds a test that may require platform specific handling in the addon template.

### Recommendation

Implement to lock shared addon behavior and surface any needed runtime wiring.
