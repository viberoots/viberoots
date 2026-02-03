## Linking Plan - Phase 4 (Optional improvements and parity)

This document is a development plan to implement Phase 4 from `linking-roadmap.md`. I keep the plan as a list of PRs. Each PR includes its own tests and documentation updates. I do not plan any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true)

This plan assumes the shared primitives and the Phase 1 through Phase 3 work are present and stable:

- shared link closure resolver in `tools/nix/planner/link-closure.nix`
- C++ native linking for `link_deps` and `header_deps`
- Wasm linking semantics for TinyGo and C++ Wasm static libs
- Python extension module support for native `kind:pyext` (and optional wasm path if already landed)

---

## PR-1: Apply shared link-closure resolver to Go cgo consumers (opt-in)

### Description

This PR lets Go cgo targets opt into following C++ `link_deps` transitively. It uses the existing link-closure resolver so the traversal is deterministic and consistent with C++ behavior.

### Scope & Changes

This PR makes the following changes:

- Extend the Go planner (`tools/nix/planner/go.nix`) to accept `link_closure` and `link_closure_overrides` for cgo consumers only.
- Route the resolved link closure into the Go template inputs that produce cgo link flags or native inputs.
- Add a targeted error when a Go cgo target opts in to `link_closure` but a dep is not a supported native producer.
- Keep the default behavior unchanged when `link_closure` is unset.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/go/go.cgo.link-closure.direct.only-direct-deps.test.ts`
  - defines a cgo binary that depends on a C++ library with `link_deps`
  - sets `link_closure="direct"` and asserts only direct libs are included
- `tools/tests/go/go.cgo.link-closure.transitive.includes-link-deps.test.ts`
  - defines a cgo binary and a library graph where `link_deps` are transitive
  - sets `link_closure="transitive"` and asserts transitive libs are included
- `tools/tests/go/go.cgo.link-closure.unsupported-producer.fails-fast.test.ts`
  - depends on a non-native target through `link_deps`
  - asserts a targeted error that names supported producers

### Docs (in this PR)

I update documentation to capture the opt-in model:

- Update `go-linking.md` to document `link_closure` and `link_closure_overrides` for cgo targets.
- Update `cpp-linking.md` to note that Go cgo consumers can opt into following C++ `link_deps`.

### Acceptance Criteria

The following must be true:

- A Go cgo target can opt into `link_closure="transitive"` and receives a deterministic native link set.
- The default behavior remains unchanged when `link_closure` is not set.
- Unsupported producers fail fast with a clear error.

### Risks

Medium. The Go cgo template wiring can be fragile if link inputs are not ordered deterministically.

### Consequence of Not Implementing

Go cgo consumers cannot reuse the existing C++ link closure semantics and must manage link deps manually.

### Downsides for Implementing

It adds planner and template logic that must remain compatible with the existing Go cgo build path.

### Recommendation

Implement if there are real cgo consumers that need transitive native linkage.

---

## PR-2: Add opt-in shared-lib support for C++ native linking

### Description

This PR adds an opt-in path to build and link shared libraries for C++ native targets. The default remains static to avoid changing existing behavior.

### Scope & Changes

This PR makes the following changes:

- Add a `link_mode` or equivalent opt-in attribute for C++ targets that can produce shared libraries.
- Extend the C++ templates to emit a shared library artifact when `link_mode="shared"`.
- Ensure the planner wires `T.cppLib` inputs for shared linkage when requested.
- Add a targeted error when a consumer requests shared linkage from a producer that does not support it.
- Keep static linking as the default path.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/cpp/cpp.link-mode.shared.library-exports-symbol.test.ts`
  - builds a shared library and a consumer binary
  - asserts the binary links and calls a symbol from the shared lib
- `tools/tests/cpp/cpp.link-mode.shared.header-only-lib.fails-fast.test.ts`
  - sets `link_mode="shared"` on a header-only target
  - asserts a targeted error that explains the mismatch
- `tools/tests/cpp/cpp.link-mode.default.static.still-works.test.ts`
  - builds existing static linkage without specifying `link_mode`
  - asserts behavior is unchanged

### Docs (in this PR)

I update documentation to describe the shared-lib opt-in:

- Update `cpp-linking.md` with the `link_mode` attribute and shared-lib behavior.
- Update `linking-roadmap.md` to mark the shared-lib opt-in as implemented.

### Acceptance Criteria

The following must be true:

- C++ targets can opt into shared linking without affecting default static behavior.
- Consumers get deterministic linkage with clear errors on unsupported cases.
- Documentation describes the new opt-in and default behavior.

### Risks

Medium. Shared linking introduces additional runtime and platform differences.

### Consequence of Not Implementing

C++ native linking remains static-only and cannot support use cases that require shared libraries.

### Downsides for Implementing

It adds a new configuration surface and requires careful compatibility handling across templates.

### Recommendation

Implement only when there is a confirmed need for shared linking in production builds.
