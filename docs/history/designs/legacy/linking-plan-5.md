## Linking Plan - Phase 5 (Python WASM extension modules: Pyodide + WASI)

This document is a development plan to add **Python WASM extension modules for the Pyodide and WASI backends**. I keep the plan as a list of PRs. Each PR includes its own tests and documentation updates. I do not plan any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true)

This plan assumes the WASI and Pyodide backends exist as real runtimes, not just banner stubs:

- `nix_python_wasm_app` and `nix_python_wasm_lib` exist and select backend via `backend:wasi` and `backend:pyodide`
- the Pyodide backend bundles and executes Python code deterministically offline
- pure-Python overlays are already merged into the Pyodide filesystem deterministically
- Phase 3 native `kind:pyext` work is present and stable (but remains native-only)

If any of these are missing, I should complete those items before attempting WASM extension support.

---

## PR-1: Add `nix_python_wasm_extension_module` macro and exported node contract (`kind:pyext_wasm`)

### Description

This PR introduces a new, explicit producer for WASM-targeted extension modules. I keep it separate from the native `kind:pyext` contract to avoid ABI confusion.

### Scope & Changes

This PR makes the following changes:

- Add `nix_python_wasm_extension_module` to `build-tools/python/defs.bzl`:
  - importer-scoped lockfile label validation (same rule as other Python macros)
  - required attrs:
    - `module` (import name, e.g. `"mypkg._native"`)
    - `srcs` and optional `headers`
  - optional attrs:
    - `cflags`, `ldflags`
    - `build_py_deps` (for header-only build inputs such as `pybind11`)
  - require an explicit backend label:
    - `backend:wasi` or `backend:pyodide`
  - wire `deps` as-is, without native `link_deps` for this phase
- Stamp `labels` with `lang:python` and `kind:pyext_wasm`
- Export the required attrs so `build-tools/tools/buck/graph.json` contains:
  - `module`, `srcs`, `cflags`, `ldflags`, `build_py_deps`
  - `labels` with `backend:<name>` to drive planner routing

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext-wasm.macro.enforces.lockfile-label.test.ts`
  - defines `nix_python_wasm_extension_module` with invalid or missing `lockfile_label`
  - asserts macro-level failure
- `build-tools/tools/tests/python/python.pyext-wasm.attrs.exported-by-graph.test.ts`
  - defines a module with `module`, `build_py_deps`, `cflags`, `ldflags`, `labels=["backend:wasi"]`
  - exports graph and asserts attrs are present on `kind:pyext_wasm`
- `build-tools/tools/tests/python/python.pyext-wasm.backend.label-required.fails-fast.test.ts`
  - defines a module without a `backend:*` label
  - asserts a targeted failure that names the required backend labels
- `build-tools/tools/tests/python/python.pyext-wasm.backend.label.invalid.fails-fast.test.ts`
  - defines a module with `labels=["backend:unknown"]`
  - asserts a targeted failure that lists supported backends

### Docs (in this PR)

I update documentation to record the new contract:

- Update `docs/history/designs/legacy/python-extension-design.md`:
  - note the separation between native `kind:pyext` and WASM `kind:pyext_wasm`
  - document the exported node fields for `kind:pyext_wasm`
- Update `build-tools/docs/lang/python-wasm-design.md`:
  - document the new macro and the backend label requirement

### Acceptance Criteria

The following must be true:

- `nix_python_wasm_extension_module` exists, is importer-scoped, and stamps `lang:python`, `kind:pyext_wasm`
- `build-tools/tools/buck/graph.json` includes `module` and build attrs for a `kind:pyext_wasm` node
- Missing or unknown backend labels fail fast with a clear error
- Documentation describes the node contract in one place

### Risks

Low. This is a new macro surface and exported node contract, with no runtime wiring yet.

### Consequence of Not Implementing

There is no stable node contract for WASM-targeted extensions, so planner work cannot proceed cleanly.

### Downsides for Implementing

It adds a new public macro surface that I must maintain.

### Recommendation

Implement.

---

## PR-2: Implement `T.pyExtWasm` for Pyodide (Emscripten build + overlay contract)

### Description

This PR introduces a dedicated Nix template that builds a Pyodide-compatible extension module with a deterministic output contract.

### Scope & Changes

This PR makes the following changes:

- Add a new template `T.pyExtWasm` under `build-tools/tools/nix/templates/python/`:
  - compile C/C++ sources with Emscripten as a side module
  - use Pyodide-provided CPython headers and build config
  - compute `EXT_SUFFIX` from the pinned Pyodide Python configuration
  - output contract:
    - `$out/site/<module path>${EXT_SUFFIX}`
- Add a pinned Pyodide toolchain input in Nix:
  - expose CPython headers for wasm32-emscripten
  - expose any required `python` config to derive `EXT_SUFFIX`
- Wire `build_py_deps` headers from the importer wheelhouse when requested

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext-wasm.builds-with-emscripten.test.ts`
  - defines a minimal extension with a known symbol
  - builds the module and asserts the output path exists at `$out/site/<module path>${EXT_SUFFIX}`
- `build-tools/tools/tests/python/python.pyext-wasm.build-py-deps.headers.available.test.ts`
  - requests a header-only Python package via `build_py_deps`
  - asserts the build succeeds

### Docs (in this PR)

I update documentation to describe the template contract:

- Update `docs/history/designs/legacy/python-extension-design.md`:
  - document `T.pyExtWasm` output contract and how `EXT_SUFFIX` is determined
- Update `build-tools/docs/lang/python-wasm-design.md`:
  - note that Pyodide extensions are built as Emscripten side modules

### Acceptance Criteria

The following must be true:

- `T.pyExtWasm` builds a Pyodide-compatible extension module
- `EXT_SUFFIX` is derived from the pinned Pyodide Python configuration
- Build-time Python headers from `build_py_deps` are available when requested

### Risks

Medium. Toolchain pinning and `EXT_SUFFIX` derivation can be fragile if Pyodide packaging changes.

### Consequence of Not Implementing

There is no deterministic build path for Pyodide-native extension artifacts.

### Downsides for Implementing

It introduces a new template and pinned toolchain surface.

### Recommendation

Implement.

---

## PR-3: Planner wiring and Pyodide runtime integration

### Description

This PR wires the new `kind:pyext_wasm` nodes into the Python planner and integrates their overlays into Pyodide app and lib outputs.

### Scope & Changes

This PR makes the following changes:

- Extend the Python planner (`build-tools/tools/nix/planner/python.nix`):
  - recognize `kind:pyext_wasm`
  - build `T.pyExtWasm` for those nodes
  - when planning `pyWasmApp` and `pyWasmLib` with `backend="pyodide"`:
    - collect direct `kind:pyext_wasm` deps
    - pass them as `nativeModuleOverlays` to the wasm templates
- Extend Pyodide templates (`build-tools/tools/nix/templates/python/wasm.nix`):
  - merge `nativeModuleOverlays` into the Pyodide filesystem deterministically
  - keep overlay order stable and explicit
- Add a targeted backend mismatch error for Pyodide apps that depend on `backend:wasi` extensions

### Tests (in this PR)

I add zx integration tests (one test per file):

- `build-tools/tools/tests/python/python.wasm.pyodide.ext.imports-and-runs.test.ts`
  - defines a Pyodide app that depends on a `kind:pyext_wasm` module
  - runs in the Pyodide harness and asserts the module is imported and executed
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.build-py-deps.headers.available.test.ts`
  - extension uses a header from `build_py_deps` and builds successfully
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.lib-consumed-by-app.test.ts`
  - Pyodide app depends on a `nix_python_wasm_lib` that depends on a `kind:pyext_wasm` module
  - assert the app runtime can import the extension from the lib overlay
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.overlay-order.deterministic.test.ts`
  - two extension overlays with conflicting paths
  - assert deterministic overlay order from planner inputs
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.backend-mismatch.fails-fast.test.ts`
  - Pyodide app depends on a `backend:wasi` extension module
  - assert a targeted backend mismatch error

### Docs (in this PR)

I update documentation to capture planner behavior:

- Update `build-tools/docs/lang/python-wasm-design.md`:
  - document how Pyodide app/lib outputs include extension overlays

### Acceptance Criteria

The following must be true:

- Pyodide apps can import and execute a `kind:pyext_wasm` module
- Overlay order is deterministic and described in docs
- Backend mismatch fails fast with a clear error

### Risks

Medium. Runtime integration is sensitive to Pyodide filesystem layout and loader behavior.

### Consequence of Not Implementing

Pyodide extensions would build but not be consumable by apps and libs.

### Downsides for Implementing

It adds planner and template logic that must track Pyodide packaging evolution.

### Recommendation

Implement.

---

## PR-4: WASI backend support for `kind:pyext_wasm` (blocked)

### Description

I add a WASI-specific build and runtime path so a WASI app or lib can import a WASM extension module. **This is blocked** by the pinned WASI runtime lacking dynamic module loading; until a compatible runtime exists, we fail fast at build time when a WASI target depends on `kind:pyext_wasm`.

This targets the backend that already exists by default (`backend` falls back to `wasi` in the planner).

### Scope & Changes

- Extend `T.pyExtWasm` (or add a `T.pyExtWasi` wrapper) for `backend="wasi"`:
  - compile C/C++ sources for `wasm32-wasi`
  - derive `EXT_SUFFIX` from the pinned CPython WASI config
  - output `$out/site/<module path>${EXT_SUFFIX}`
  - use the importer wheelhouse env for `build_py_deps` headers
- Extend the Python planner (`build-tools/tools/nix/planner/python.nix`):
  - route `kind:pyext_wasm` nodes with `backend="wasi"` to the WASI path
  - reject mismatched backend combinations with a targeted error
- Extend the WASI runtime path in `build-tools/tools/nix/templates/python/wasm.nix`:
  - ensure the WASI runner uses a CPython WASI runtime capable of loading extension modules
  - keep the existing pure-Python behavior intact

### Tests (in this PR)

I add zx integration tests (one test per file):

- `build-tools/tools/tests/python/python.wasm.wasi.ext.imports-and-runs.test.ts`
  - WASI app depends on a `kind:pyext_wasm` module via `nix_python_wasm_app`
  - asserts a targeted build-time failure until a dynamic-loading runtime is pinned
- `build-tools/tools/tests/python/python.wasm.wasi.ext.build-py-deps.headers.available.test.ts`
  - extension uses a header from `build_py_deps` and builds successfully
- `build-tools/tools/tests/python/python.wasm.wasi.ext.lib-consumed-by-app.test.ts`
  - WASI app depends on a `nix_python_wasm_lib` that depends on a `kind:pyext_wasm` module
  - assert the app runtime can import the extension from the lib overlay
- `build-tools/tools/tests/python/python.wasm.wasi.ext.backend-mismatch.fails-fast.test.ts`
  - WASI app depends on a `backend:pyodide` extension module
  - assert a targeted error

### Docs (in this PR)

- Update `docs/history/designs/legacy/python-extension-design.md`:
  - document the WASI `kind:pyext_wasm` build and runtime constraints
- Update `build-tools/docs/lang/python-wasm-design.md`:
  - document the WASI extension module runtime requirements

### Acceptance Criteria

- WASI apps and libs can import a `kind:pyext_wasm` module once a compatible runtime is pinned.
- `EXT_SUFFIX` is derived from the pinned CPython WASI config.
- Backend mismatches fail fast with a clear error.

### Risks

Medium. WASI runtime support for extension loading can be limited and needs to be pinned and tested.

### Consequence of Not Implementing

WASI remains pure-Python only for this repo’s Python WASM backends; `kind:pyext_wasm` deps fail fast.

### Downsides for Implementing

Adds runtime and toolchain constraints for the WASI backend.

### Recommendation

Implement.

---

## PR-5: Optional follow-up for in-repo WASM native linking

### Description

This PR is optional and only needed if we want `kind:pyext_wasm` to link against in-repo WASM libraries.

### Scope & Changes

This PR makes the following changes:

- Extend `kind:pyext_wasm` to accept `link_deps` and `header_deps`
- Use the existing link-closure resolver for deterministic ordering
- Restrict supported producers to wasm-capable C++ libraries
- Fail fast on unsupported targets

### Tests (in this PR)

I add zx integration tests (one test per file):

- `build-tools/tools/tests/python/python.wasm.pyodide.ext.links-wasm-lib.builds-and-runs.test.ts`
  - links a wasm C++ library and calls a symbol through the extension (Pyodide backend)
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.link-deps.unsupported-target.fails-fast.test.ts`
  - asserts a targeted error for unsupported producers

### Docs (in this PR)

I update documentation to describe the link model:

- Update `docs/history/designs/legacy/python-extension-design.md` and `build-tools/docs/lang/python-wasm-design.md` with the supported producers and closure rules

### Acceptance Criteria

The following must be true:

- A Pyodide extension can link a wasm-capable in-repo library and run successfully
- Unsupported link deps fail fast with a targeted error

### Risks

Medium. WASM link ordering and toolchain differences can be subtle.

### Consequence of Not Implementing

Pyodide extensions remain limited to direct sources plus external deps.

### Downsides for Implementing

It expands planner logic and link surface area across languages.

### Recommendation

Implement only when there is a real consumer need.

---

## PR-6: Fix inline exporter attr coverage for `kind:pyext_wasm`

### Description

This PR closes the graph export gap where inline export omits the `module` attribute.

### Scope & Changes

This PR makes the following changes:

- Include `module` in the inline exporter attribute list
- Keep attr parity between `build-tools/tools/buck/export-graph.ts` and `build-tools/tools/buck/export-inline.ts`

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext-wasm.attrs.exported-by-inline-graph.test.ts`
  - runs the inline exporter path
  - asserts `module`, `cflags`, `ldflags`, `build_py_deps` are present for `kind:pyext_wasm`

### Docs (in this PR)

No doc changes. This is a parity fix.

### Acceptance Criteria

The following must be true:

- Inline export includes `module` for `kind:pyext_wasm` nodes
- Inline export matches the attr list used by the cquery exporter

### Risks

Low. The change is additive.

### Consequence of Not Implementing

Fallback graph export can drop `module` for `kind:pyext_wasm`, breaking planner wiring in some environments.

### Downsides for Implementing

Minimal.

### Recommendation

Implement.

---

## PR-7: Pin WASI Python config for `T.pyExtWasi`

### Description

This PR aligns the WASI extension template with the pinned CPython WASI toolchain and removes reliance on host Python for `EXT_SUFFIX` and include paths.

### Scope & Changes

This PR makes the following changes:

- Add a pinned WASI CPython toolchain input under `build-tools/tools/nix/toolchains`
- Update `T.pyExtWasi` to derive `EXT_SUFFIX` and include paths from the pinned toolchain
- Keep the existing overlay contract and output path unchanged

### Tests (in this PR)

I add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext-wasm.wasi.ext-suffix.uses-pinned-toolchain.test.ts`
  - builds a WASI extension
  - asserts the suffix matches the pinned toolchain value

### Docs (in this PR)

I update documentation to record the toolchain source:

- Update `docs/history/designs/legacy/python-extension-design.md` with the pinned WASI config source for `EXT_SUFFIX`
- Update `build-tools/docs/lang/python-wasm-design.md` with the same detail

### Acceptance Criteria

The following must be true:

- `T.pyExtWasi` no longer relies on host `python3` for `EXT_SUFFIX` or include dirs
- The pinned toolchain is the single source of truth for WASI config

### Risks

Medium. Toolchain pinning can be brittle if upstream layout changes.

### Consequence of Not Implementing

WASI extensions remain tied to host Python config and can drift across machines.

### Downsides for Implementing

Adds a toolchain pin that must be maintained.

### Recommendation

Implement.

---

## PR-8: Runtime execution for Pyodide extensions + WASI fail-fast

### Description

This PR makes the Pyodide runtime path actually import and execute `kind:pyext_wasm` modules in tests, rather than only asserting overlay presence. For WASI, the planner fails fast at build time when `kind:pyext_wasm` deps are present because the pinned runtime lacks dynamic module loading.

### Scope & Changes

This PR makes the following changes:

- Add a Pyodide test harness path that runs a headless runtime and imports the extension
- Replace banner-only assertions with runtime assertions that call a function from the extension (Pyodide)
- Fail fast at build time when a WASI app/lib depends on `kind:pyext_wasm` targets

### Tests (in this PR)

I add zx integration tests (one test per file):

- `build-tools/tools/tests/python/python.wasm.pyodide.ext.imports-and-runs.test.ts`
  - builds a Pyodide app with a `kind:pyext_wasm` dep
  - runs the headless Pyodide harness and asserts a function call result
- `build-tools/tools/tests/python/python.wasm.pyodide.ext.links-wasm-lib.builds-and-runs.test.ts`
  - builds a Pyodide extension with a wasm static lib
  - asserts the linked symbol is invoked at runtime
- `build-tools/tools/tests/python/python.wasm.wasi.ext.imports-and-runs.test.ts`
  - builds a WASI app with a `kind:pyext_wasm` dep
  - asserts a targeted build-time failure

### Docs (in this PR)

I update documentation to align with the runtime behavior:

- Update `build-tools/docs/lang/python-wasm-design.md` with the runtime execution contract for tests
- Update `docs/history/designs/legacy/python-extension-design.md` to clarify that tests must execute, not just build

### Acceptance Criteria

The following must be true:

- Pyodide tests execute the runtime and import the extension
- Pyodide tests assert a real function call result from the extension module
- WASI tests fail fast at build time when `kind:pyext_wasm` deps are present
- Overlay-only checks are no longer the sole signal for success

### Risks

Medium. Runtime harnesses can be sensitive to toolchain versions and environment; WASI is currently limited by runtime capability.

### Consequence of Not Implementing

The plan claims runtime support without tests that prove it.

### Downsides for Implementing

Adds test runtime dependencies and longer test time; WASI is explicitly fail-fast until a compatible runtime is available.

### Recommendation

Implement.
