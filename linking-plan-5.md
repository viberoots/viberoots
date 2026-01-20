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

- Add `nix_python_wasm_extension_module` to `python/defs.bzl`:
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
- Export the required attrs so `tools/buck/graph.json` contains:
  - `module`, `srcs`, `cflags`, `ldflags`, `build_py_deps`
  - `labels` with `backend:<name>` to drive planner routing

### Tests (in this PR)

I add zx tests (one test per file):

- `tools/tests/python/python.pyext-wasm.macro.enforces.lockfile-label.test.ts`
  - defines `nix_python_wasm_extension_module` with invalid or missing `lockfile_label`
  - asserts macro-level failure
- `tools/tests/python/python.pyext-wasm.attrs.exported-by-graph.test.ts`
  - defines a module with `module`, `build_py_deps`, `cflags`, `ldflags`, `labels=["backend:wasi"]`
  - exports graph and asserts attrs are present on `kind:pyext_wasm`
- `tools/tests/python/python.pyext-wasm.backend.label-required.fails-fast.test.ts`
  - defines a module without a `backend:*` label
  - asserts a targeted failure that names the required backend labels
- `tools/tests/python/python.pyext-wasm.backend.label.invalid.fails-fast.test.ts`
  - defines a module with `labels=["backend:unknown"]`
  - asserts a targeted failure that lists supported backends

### Docs (in this PR)

I update documentation to record the new contract:

- Update `python-extension-design.md`:
  - note the separation between native `kind:pyext` and WASM `kind:pyext_wasm`
  - document the exported node fields for `kind:pyext_wasm`
- Update `python-wasm-design.md`:
  - document the new macro and the backend label requirement

### Acceptance Criteria

The following must be true:

- `nix_python_wasm_extension_module` exists, is importer-scoped, and stamps `lang:python`, `kind:pyext_wasm`
- `tools/buck/graph.json` includes `module` and build attrs for a `kind:pyext_wasm` node
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

- Add a new template `T.pyExtWasm` under `tools/nix/templates/python/`:
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

- `tools/tests/python/python.pyext-wasm.builds-with-emscripten.test.ts`
  - defines a minimal extension with a known symbol
  - builds the module and asserts the output path exists at `$out/site/<module path>${EXT_SUFFIX}`
- `tools/tests/python/python.pyext-wasm.build-py-deps.headers.available.test.ts`
  - requests a header-only Python package via `build_py_deps`
  - asserts the build succeeds

### Docs (in this PR)

I update documentation to describe the template contract:

- Update `python-extension-design.md`:
  - document `T.pyExtWasm` output contract and how `EXT_SUFFIX` is determined
- Update `python-wasm-design.md`:
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

- Extend the Python planner (`tools/nix/planner/python.nix`):
  - recognize `kind:pyext_wasm`
  - build `T.pyExtWasm` for those nodes
  - when planning `pyWasmApp` and `pyWasmLib` with `backend="pyodide"`:
    - collect direct `kind:pyext_wasm` deps
    - pass them as `nativeModuleOverlays` to the wasm templates
- Extend Pyodide templates (`tools/nix/templates/python/wasm.nix`):
  - merge `nativeModuleOverlays` into the Pyodide filesystem deterministically
  - keep overlay order stable and explicit
- Add a targeted backend mismatch error for Pyodide apps that depend on `backend:wasi` extensions

### Tests (in this PR)

I add zx integration tests (one test per file):

- `tools/tests/python/python.wasm.pyodide.ext.imports-and-runs.test.ts`
  - defines a Pyodide app that depends on a `kind:pyext_wasm` module
  - runs in the Pyodide harness and asserts the module is imported and executed
- `tools/tests/python/python.wasm.pyodide.ext.build-py-deps.headers.available.test.ts`
  - extension uses a header from `build_py_deps` and builds successfully
- `tools/tests/python/python.wasm.pyodide.ext.lib-consumed-by-app.test.ts`
  - Pyodide app depends on a `nix_python_wasm_lib` that depends on a `kind:pyext_wasm` module
  - assert the app runtime can import the extension from the lib overlay
- `tools/tests/python/python.wasm.pyodide.ext.overlay-order.deterministic.test.ts`
  - two extension overlays with conflicting paths
  - assert deterministic overlay order from planner inputs
- `tools/tests/python/python.wasm.pyodide.ext.backend-mismatch.fails-fast.test.ts`
  - Pyodide app depends on a `backend:wasi` extension module
  - assert a targeted backend mismatch error

### Docs (in this PR)

I update documentation to capture planner behavior:

- Update `python-wasm-design.md`:
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

## PR-4: WASI backend support for `kind:pyext_wasm`

### Description

I add a WASI-specific build and runtime path so a WASI app or lib can import a WASM extension module.

This targets the backend that already exists by default (`backend` falls back to `wasi` in the planner).

### Scope & Changes

- Extend `T.pyExtWasm` (or add a `T.pyExtWasi` wrapper) for `backend="wasi"`:
  - compile C/C++ sources for `wasm32-wasi`
  - derive `EXT_SUFFIX` from the pinned CPython WASI config
  - output `$out/site/<module path>${EXT_SUFFIX}`
  - use the importer wheelhouse env for `build_py_deps` headers
- Extend the Python planner (`tools/nix/planner/python.nix`):
  - route `kind:pyext_wasm` nodes with `backend="wasi"` to the WASI path
  - reject mismatched backend combinations with a targeted error
- Extend the WASI runtime path in `tools/nix/templates/python/wasm.nix`:
  - ensure the WASI runner uses a CPython WASI runtime capable of loading extension modules
  - keep the existing pure-Python behavior intact

### Tests (in this PR)

I add zx integration tests (one test per file):

- `tools/tests/python/python.wasm.wasi.ext.imports-and-runs.test.ts`
  - WASI app depends on a `kind:pyext_wasm` module via `nix_python_wasm_app`
  - run via the WASI runner and assert the module executes
- `tools/tests/python/python.wasm.wasi.ext.build-py-deps.headers.available.test.ts`
  - extension uses a header from `build_py_deps` and builds successfully
- `tools/tests/python/python.wasm.wasi.ext.lib-consumed-by-app.test.ts`
  - WASI app depends on a `nix_python_wasm_lib` that depends on a `kind:pyext_wasm` module
  - assert the app runtime can import the extension from the lib overlay
- `tools/tests/python/python.wasm.wasi.ext.backend-mismatch.fails-fast.test.ts`
  - WASI app depends on a `backend:pyodide` extension module
  - assert a targeted error

### Docs (in this PR)

- Update `python-extension-design.md`:
  - document the WASI `kind:pyext_wasm` build and runtime constraints
- Update `python-wasm-design.md`:
  - document the WASI extension module runtime requirements

### Acceptance Criteria

- WASI apps and libs can import a `kind:pyext_wasm` module.
- `EXT_SUFFIX` is derived from the pinned CPython WASI config.
- Backend mismatches fail fast with a clear error.

### Risks

Medium. WASI runtime support for extension loading can be limited and needs to be pinned and tested.

### Consequence of Not Implementing

WASI remains pure-Python only for this repo’s Python WASM backends.

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

- `tools/tests/python/python.wasm.pyodide.ext.links-wasm-lib.builds-and-runs.test.ts`
  - links a wasm C++ library and calls a symbol through the extension (Pyodide backend)
- `tools/tests/python/python.wasm.pyodide.ext.link-deps.unsupported-target.fails-fast.test.ts`
  - asserts a targeted error for unsupported producers

### Docs (in this PR)

I update documentation to describe the link model:

- Update `python-extension-design.md` and `python-wasm-design.md` with the supported producers and closure rules

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
