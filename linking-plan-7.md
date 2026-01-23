## Linking Plan - Phase 5.5 (Wasm linking gaps and compliance fixes)

This document is a development plan to close the gaps identified in the wasm linking review. I keep the plan as a list of PRs. Each PR includes its own tests and documentation updates. I do not plan any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true)

This plan assumes the shared primitives and prior linking phases are present and stable:

- shared link closure resolver in `tools/nix/planner/link-closure.nix`
- TinyGo wasm linking semantics for `nix_go_tiny_wasm_lib`
- C++ wasm static lib support for `nix_cpp_wasm_static_lib`
- exporter surfaces `link_deps`, `link_closure`, and `link_closure_overrides`

---

## PR-1: TinyGo wasm per-dep closure overrides are observable and tested

### Description

This PR makes per-dep link closure overrides for TinyGo wasm observable in build output and adds a test that locks the behavior. It closes the gap where overrides are implemented but not covered by a wasm-specific test.

### Scope & Changes

This PR makes the following changes:

- Extend the TinyGo wasm planner path to emit a structured override summary that is passed to the template.
- Update `tools/nix/templates/go-tiny-wasm.nix` to log the override summary in `build.log`.
- Add a wasm test that sets `link_closure="direct"` and uses `link_closure_overrides` to mark one dep as transitive, then asserts the resolved `wasmStaticLibLabels` order and the logged override summary.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/wasm/wasm.tinygo.link-closure.overrides.apply.deterministic.test.ts`
  - defines a TinyGo wasm target with two `link_deps`
  - sets `link_closure="direct"` and overrides one dep to `transitive`
  - asserts `wasmStaticLibLabels` ordering and the override summary line in `build.log`

### Docs (in this PR)

I update documentation to describe the observable override behavior:

- Update `wasm-linking.md` to note the build log now records `link_closure_overrides` for TinyGo wasm builds.

### Acceptance Criteria

The following must be true:

- A TinyGo wasm target with per-dep overrides produces a deterministic link closure.
- The override summary is present in `build.log`.
- The new test passes and fails if the override behavior regresses.

### Risks

Low. This adds a small logging surface and a planner-to-template value without changing resolution logic.

### Consequence of Not Implementing

Per-dep override behavior stays untested in wasm, making regressions harder to catch.

### Downsides for Implementing

Adds a small planner and template interface surface that must remain stable.

### Recommendation

Implement to lock down override behavior with a direct test and observable output.

---

## PR-2: Split Go planner to meet 250-line file limit and keep wasm logic isolated

### Description

This PR refactors the Go planner to comply with the file size limit while keeping TinyGo wasm logic easy to audit and test. It is a pure refactor with no behavior change.

### Scope & Changes

Before refactoring, I document the relocation plan and cleanup targets:

- Move `mkTinyWasm` and its helper functions from `tools/nix/planner/go.nix` to a new module `tools/nix/planner/go-wasm.nix`.
- Keep non-wasm Go planner logic in `tools/nix/planner/go.nix`.
- Update imports and exports so `go.nix` delegates TinyGo wasm handling to `go-wasm.nix`.
- Remove any now-unused helper definitions in `go.nix` after the move.

This PR makes the following changes:

- Create `tools/nix/planner/go-wasm.nix` with `mkTinyWasm` and its helper functions.
- Update `tools/nix/planner/go.nix` to call into the new module.
- Ensure both files stay under the 250-line limit.

### Tests (in this PR)

I run existing tests that cover the wasm planner behavior:

- `tools/tests/wasm/wasm.tinygo.links-cpp-wasm-static-lib.via-link-deps.build-and-load.test.ts`
- `tools/tests/wasm/wasm.tinygo.transitive-closure.follows-link-deps.builds.test.ts`
- `tools/tests/wasm/wasm.link-input-ordering.deterministic.test.ts`

### Docs (in this PR)

I update documentation to reflect the new planner module split:

- Update `build-system-design.md` to list the new `tools/nix/planner/go-wasm.nix` module and its responsibility.

### Acceptance Criteria

The following must be true:

- `tools/nix/planner/go.nix` and `tools/nix/planner/go-wasm.nix` are each at or under 250 lines.
- All listed wasm tests pass with no behavior changes.
- The new module split is documented.

### Risks

Low. This is a refactor, but a mistake can break planner imports or Nix evaluation.

### Consequence of Not Implementing

The planner continues to violate the file size rule and the wasm logic remains harder to isolate.

### Downsides for Implementing

Refactor cost and risk of import errors without functional gain.

### Recommendation

Implement to keep the planner compliant with the methodology and maintainable.
