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

- Update `build-tools/docs/wasm-linking.md` to note the build log now records `link_closure_overrides` for TinyGo wasm builds.

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

- Update `build-tools/docs/build-system-design.md` to list the new `tools/nix/planner/go-wasm.nix` module and its responsibility.

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

---

## PR-3: Buck path opt-in for selected-wasm is tested and locked

### Description

This PR adds a Buck-side test that proves `use_selected_wasm = True` routes `nix_go_tiny_wasm_lib` through the minimal `graph-generator-selected-wasm` path. It closes the gap where the flag exists but its behavior is not covered by a test.

### Scope & Changes

This PR makes the following changes:

- Add a zx test that creates a TinyGo wasm target with `use_selected_wasm = True` and asserts the build path is `graph-generator-selected-wasm` by checking the build log and emitted output path.
- Keep the macro and rule behavior unchanged; the test only locks the existing behavior.

### Tests (in this PR)

I add a zx test (one test per file):

- `tools/tests/go/go.tinygo-wasm.use-selected-wasm.builds-via-minimal-path.test.ts`
  - defines a TinyGo wasm target with `use_selected_wasm = True`
  - runs a Buck build for the target
  - asserts the build log indicates the selected-wasm path and the output contains `lib/top.wasm`

### Docs (in this PR)

I update documentation to make the opt-in path explicit and test-backed:

- Update `build-tools/docs/wasm-linking.md` to mention the Buck-side opt-in is validated by a test and uses `graph-generator-selected-wasm`.

### Acceptance Criteria

The following must be true:

- The new test fails if the selected-wasm path is not used when `use_selected_wasm = True`.
- The test passes on all supported platforms.
- The documentation reflects the test-backed behavior.

### Risks

Low. This is a test-only addition over existing behavior.

### Consequence of Not Implementing

The selected-wasm opt-in path remains untested and could regress without detection.

### Downsides for Implementing

Adds a small test and maintenance burden when test helpers change.

### Recommendation

Implement to lock down the opt-in path and prevent regressions.

---

## PR-4: WASI target stamping for C++ wasm static libs is explicit and tested

### Description

This PR makes WASI compatibility explicit for `nix_cpp_wasm_static_lib` by adding a macro-level `wasm_abi` attribute that stamps `wasm:wasi` when set to `wasi`. It closes the gap where docs imply WASI labeling but call sites must manually add the label.

### Scope & Changes

This PR makes the following changes:

- Add an optional attribute to `nix_cpp_wasm_static_lib`: `wasm_abi = "bare" | "wasi"` (default: `bare`).
- When `wasm_abi = "wasi"`, stamp `wasm:wasi` in addition to the existing wasm static labels.
- Map `wasm_abi` to the concrete target triple (`wasm32-unknown-unknown` vs `wasm32-wasi`) in one place and thread the resolved value to the planner-visible node.
- Update the TinyGo wasm planner tests to use `wasm_abi = "wasi"` rather than manual `wasm:wasi` labels.

### Tests (in this PR)

I add/update zx tests (one test per file):

- Add `tools/tests/cpp/cpp.wasm-static-lib.wasi-stamping.from-wasm-abi.test.ts`
  - defines a `nix_cpp_wasm_static_lib` with `wasm_abi = "wasi"`
  - asserts `wasm:wasi` appears in exported labels
- Update `tools/tests/wasm/wasm.variant-mismatch.wasi-vs-bare.fails-fast.test.ts`
  - replace manual `wasm:wasi` label with `wasm_abi = "wasi"`
  - keep the failure expectation and targeted error message
- Update `tools/tests/wasm/wasm.link-input-ordering.deterministic.test.ts`
  - replace manual `wasm:wasi` label with `wasm_abi = "wasi"`

### Docs (in this PR)

I update documentation to describe the new attribute:

- Update `build-tools/docs/wasm-linking.md` to show `wasm_abi = "wasi"` in C++ wasm static lib examples and explain automatic `wasm:wasi` stamping and the internal mapping to `wasm32-wasi`.

### Acceptance Criteria

The following must be true:

- `nix_cpp_wasm_static_lib` stamps `wasm:wasi` automatically when `wasm_abi = "wasi"`.
- The updated wasm tests pass without manual `wasm:wasi` labels.
- The doc examples align with the new attribute.

### Risks

Low. This is a macro-level attribute addition with predictable label behavior.

### Consequence of Not Implementing

WASI compatibility remains implicit and relies on manual labeling, which is easy to miss.

### Downsides for Implementing

Adds a small macro surface area that must remain stable across languages.

### Recommendation

Implement to make WASI compatibility explicit, deterministic, and test-backed.

---

## PR-5: Python native extensions always invalidate on `uv.lock` changes

### Description

This PR closes the remaining correctness gap for native Python extensions: `kind:pyext` must invalidate when the importer `uv.lock` changes, even when `build_py_deps` is empty. Today, the planner only constructs a wheelhouse when `build_py_deps` is non-empty, which means a lockfile change can leave extension outputs cached. This PR makes `uv.lock` a deterministic input to `T.pyExt` in all cases and locks the behavior with a test.

### Scope & Changes

This PR makes the following changes:

- Extend the Python planner to pass a lockfile input for `kind:pyext` unconditionally.
- Update `tools/nix/templates/python/pyext.nix` to accept the lockfile input and use it as an explicit build-time input even when no wheelhouse is used.
- Keep the existing optimization: only instantiate the wheelhouse env when `build_py_deps` is non-empty.

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/python/python.pyext.lockfile-invalidation.rebuilds-on-uv-lock-change.test.ts`
  - builds a `kind:pyext` with empty `build_py_deps`
  - edits the importer `uv.lock` in a temp repo
  - asserts the extension derivation rebuilds (and a control target without pyext stays cached)

### Docs (in this PR)

I update documentation to clarify the invalidation rule:

- Update `build-tools/docs/python-extension-design.md` to explicitly state that `uv.lock` is a required input for `T.pyExt` even when `build_py_deps` is empty.

### Acceptance Criteria

The following must be true:

- A `kind:pyext` target rebuilds when its importer `uv.lock` changes, regardless of `build_py_deps`.
- The new test fails if lockfile invalidation regresses.
- Documentation reflects the unconditional lockfile dependency.

### Risks

Low. This adds an explicit input and does not change the build outputs or linking logic.

### Consequence of Not Implementing

Native extension artifacts can become stale relative to the importer lockfile, violating determinism guarantees.

### Downsides for Implementing

Slightly broader invalidation scope for pyext builds, but aligned with the design.

### Recommendation

Implement to guarantee deterministic invalidation for Python native extensions.

---

## PR-6: Split oversized Python planner modules to comply with the 250-line rule

### Description

This PR brings the Python planner and uv2nix adapter back into methodology compliance by splitting oversized modules into smaller, single-responsibility files. It is a refactor with no behavior change, paired with tests and updated documentation.

### Scope & Changes

This PR makes the following changes:

- Split `tools/nix/planner/python.nix` into smaller modules (e.g., `python-core.nix`, `python-pyext.nix`, `python-wasm.nix`), keeping each file at or under 250 lines.
- Split `tools/nix/uv2nix-adapter.nix` into a thin wrapper plus focused helper modules (e.g., `uv2nix-inputs.nix`, `uv2nix-overlays.nix`, `uv2nix-env.nix`).
- Ensure all imports are centralized and the planner entrypoint remains `tools/nix/planner/python.nix`.

### Tests (in this PR)

I run existing tests that cover Python planner behavior and uv2nix materialization:

- `tools/tests/python/python.pyext.imported-by-pyapp.build-and-run.test.ts`
- `tools/tests/python/python.pyext.transitive-closure.follows-link-deps.build-and-run.test.ts`
- `tools/tests/python/python.pyext-wasm.builds-with-emscripten.test.ts`

### Docs (in this PR)

I update documentation to reflect the module split:

- Update `build-tools/docs/build-system-design.md` to list the new Python planner module layout and the uv2nix adapter split.

### Acceptance Criteria

The following must be true:

- All Python planner and uv2nix adapter files are at or under 250 lines.
- The listed Python tests pass without behavior changes.
- Documentation reflects the new module boundaries.

### Risks

Low. This is a refactor; the main risk is import miswiring in Nix.

### Consequence of Not Implementing

The Python planner continues to violate the methodology’s file size constraint, and the adapter remains harder to audit.

### Downsides for Implementing

Refactor cost and minor risk of Nix evaluation errors.

### Recommendation

Implement to restore compliance and maintainability without changing behavior.
