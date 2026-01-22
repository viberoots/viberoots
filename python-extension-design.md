# Python native extension modules (in-repo) — design

This document describes the minimal “PR-2” shape for **in-repo CPython extension modules**: C/C++ code compiled into an importable module (e.g. `demo._native`) and composed into **planner-built** Python app/lib outputs.

It is intended to match:

- `build-system-design.md` (Buck2 exports intent; Nix realizes; deterministic inputs)
- `linking-roadmap.md` / `linking-plan-4.md` (Python extension modules phase)
- `METHODOLOGY.XML` (minimalism, deterministic reliability, reuse existing helpers)

## Scope (what this enables)

This design focuses on **in-repo** native modules (not arbitrary third-party wheels).

The core requirements are:

- **planner-visible node** in the Buck graph (`kind:pyext`) that records module name + link intent attrs
- **Nix template** `T.pyExt` that produces an overlay at `$out/site/<module path>${EXT_SUFFIX}`
- **Python app/lib outputs** that merge those overlays into the final runtime site-packages deterministically

## Non-goals (for this phase)

To keep PR-2 small and reliable, this phase does not attempt:

- **WASM**: native modules are not supported for Python WASI/Pyodide backends (pure-Python only today)
- **multi-ABI packaging**: no abi3 / manylinux matrix; we build for the pinned interpreter we run
- **Buck-run runtime**: importing native modules directly under Buck’s `python_test` rules is out of scope

## Buck graph contract

The Buck-side target shape is:

- **labels**: `lang:python`, `kind:pyext`
- **attrs**:
  - `module` (e.g. `"demo._native"`)
  - `srcs` (C/C++ sources)
  - `cflags`, `ldflags`
  - link intent attrs (`link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`)

## WASM extension modules (separate contract)

I keep WASM-targeted extension modules separate from native `kind:pyext` to avoid ABI confusion. The WASM contract is a graph-only producer and does not imply native CPython wiring.

- **labels**: `lang:python`, `kind:pyext_wasm`, plus one explicit backend label (`backend:wasi` or `backend:pyodide`)
- **attrs**:
  - `module` (e.g. `"demo._native"`)
  - `srcs` and optional `headers`
  - `cflags`, `ldflags`
  - `build_py_deps` (build-time Python packages for headers)
  - link intent attrs (`link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`)

The WASM link model is intentionally narrower than native `kind:pyext`:

- supported `link_deps`: `lang:cpp`, `kind:wasm`, `wasm:static`
- supported `header_deps`: `lang:cpp`, `kind:headers`
- backend guardrails:
  - `backend:wasi` requires linked deps to also be stamped `wasm:wasi`
  - `backend:pyodide` rejects `wasm:wasi` deps to avoid ABI mismatches

### WASM runtime wrapper

For WASM apps and libs, the runtime harness executes the importer entrypoint and exercises extension imports:

- WASI: Node’s WASI runner executes the pinned `python.wasm` with `PYTHONHOME` pointing at the runtime stdlib and `PYTHONPATH=/site`.
- Pyodide: a headless Node harness loads the pinned Pyodide runtime, mounts `/site`, and runs `bin/__main__.py`.

## Nix realization contract

### `T.pyExt`

`T.pyExt` produces an overlay with exactly one responsibility: an importable extension module under `$out/site`.

- **output path**: `$out/site/<module path>${EXT_SUFFIX}`
- **example**: `demo._native` → `$out/site/demo/_native${EXT_SUFFIX}`

The `EXT_SUFFIX` is derived from the pinned interpreter at build time (via `sysconfig`) to avoid hardcoding CPython tags.

### `T.pyExtWasm` (Pyodide)

I add a dedicated template for Pyodide-targeted extension modules. It builds an Emscripten side module and places the output under the same `$out/site` overlay contract so planners can compose it later.

- **output path**: `$out/site/<module path>${EXT_SUFFIX}`
- **example**: `demo._native` → `$out/site/demo/_native${EXT_SUFFIX}`

The `EXT_SUFFIX` is derived from the pinned Pyodide sysconfig data for wasm32-emscripten.

### `T.pyExtWasi`

I add a WASI-specific template for `kind:pyext_wasm` that compiles sources for `wasm32-wasi` and emits the same overlay contract. **However, the pinned WASI CPython runtime does not support dynamic module loading**, so WASI apps/libs fail fast at build time if they depend on `kind:pyext_wasm`. Use `backend:pyodide` for runnable extension modules today.

- **output path**: `$out/site/<module path>${EXT_SUFFIX}`
- **example**: `demo._native` → `$out/site/demo/_native${EXT_SUFFIX}`

The `EXT_SUFFIX` and include headers come from the pinned WASI toolchain at `tools/nix/toolchains/python-wasi.nix`. `T.pyExtWasi` does not read host Python config for these values.

### `pyApp` / `pyLib` overlay composition

`T.pyApp` / `T.pyLib` accept:

- `nativeModuleOverlays = [ <pyExt derivation> ... ]`

The uv2nix adapter is responsible for deterministic composition:

- **materialize** uv2nix site-packages into `$out/site`
- **copy importer sources** (`<importer>/src/**`) into `$out/site` so Python packages live in one place
- **merge overlays** (`$ov/site/**`) into `$out/site` in a stable order

This “copy sources into site” step is important: regular Python packages (`__init__.py` present) do not combine across multiple directories on `sys.path`, so native submodules must land alongside the package directory that Python actually imports.

### Runtime wrapper

The runnable wrapper under `$out/bin/*`:

- runs the **pinned** Nix Python interpreter (so ABI and `EXT_SUFFIX` match the built modules)
- sets `PYTHONPATH` with `$out/site` first
- executes the importer’s `bin/__main__.py`

## Determinism and invalidation

The intent is that extension builds are invalidated by the same importer-scoped inputs as Python apps/libs, plus extension-local sources:

- importer `uv.lock`
- importer-local patches (`patches/python/**`)
- extension sources (`srcs`) and build flags (`cflags`, `ldflags`)
- nixpkgs native inputs requested via `nixpkg:` labels

## PR-5: Phase 3 invariants (hardening)

After Phase 3 works end-to-end, we lock down the invariants that keep it stable and predictable.

### Determinism (ordering)

- **Native link closure ordering**: the Python planner resolves `kind:pyext` `link_deps` using `tools/nix/planner/link-closure.nix`:
  - roots are visited in order
  - when a node is `"transitive"`, its `link_deps` are visited in order
  - each dep appears at most once (first occurrence wins)
- **Overlay merge ordering**: `pyApp` / `pyLib` merge `nativeModuleOverlays` in the order provided by the planner.
  - The uv2nix adapter copies each overlay’s `$out/site/**` into the final `$out/site/**` by iterating the overlay list in order.
  - Overlay ordering is a semantic choice when two overlays collide on the same path. The planner order is the only source of truth.

### Invalidation (in-repo native deps)

When a Python extension links an in-repo native producer, patch edits under that producer must invalidate:

- the producer derivation (e.g. `T.cppLib`)
- the extension derivation (`T.pyExt`)
- the downstream Python app/lib runtime that imports the extension

The required rule for Phase 3 is:

- native producer patch files are part of the exported graph surface (typically by being included in the producer target’s `srcs`)
- the Python planner passes those patch files as explicit `patches` inputs when materializing repo-native producers (`T.cppLib`, `T.cppHeaders`)

This avoids “hidden dependencies” where the planner links a repo native target but patch changes do not appear in the planner-visible graph inputs.

### Backend boundaries (WASM)

Python WASM backends (WASI / Pyodide) remain **pure-Python only** for this phase:

- if a `kind:wasm` Python target has any `kind:pyext` target in its dependency closure, the Python planner fails fast with a targeted error that names the offending `kind:pyext` targets

## PR-3: Build-time Python deps for `T.pyExt` (uv wheelhouse env)

Many extension modules need **Python packages at build time** (headers from `numpy`, `pybind11`, or project-specific helper packages).

To keep this deterministic and importer-scoped, `T.pyExt` builds against the **same uv2nix wheelhouse environment** as its importer:

- The wheelhouse is keyed only by:
  - importer `uv.lock`
  - importer-local Python patches (`<importer>/patches/python/*.patch`)
  - global Nix inputs (via the existing uv2nix machinery)
- It is **not** keyed by extension sources.

### `build_py_deps` (exported graph contract)

`kind:pyext` nodes may set:

- `build_py_deps: [ "pkg", ... ]`

When non-empty, `T.pyExt`:

- uses the importer wheelhouse’s `$out/site` as `PYTHONPATH` during compilation
- for each requested package, resolves a deterministic include directory by:
  - calling `<pkg>.get_include()` when available, otherwise
  - using `<pkg>/include` next to the imported module
- adds `-I<includeDir>` for each resolved include directory

This keeps build-time Python deps:

- **explicit** at the Buck surface
- **hermetic** (no user site-packages)
- **deterministic** (wheelhouse key is importer-scoped)
- **fast by default**: when `build_py_deps` is empty, `T.pyExt` does not instantiate the wheelhouse env at all (so simple extensions don’t pay for uv2nix).

## PR-4: In-repo native linking for Python extensions (`link_deps` / `header_deps`)

Python extension modules should be able to link in-repo native code explicitly, using the same “link intent” model as C++ targets:

- `link_deps`: link-time intent (the planner follows these edges for closure)
- `header_deps`: include-time intent (header-only surfaces)
- `link_closure`: `"direct"` or `"transitive"`
- `link_closure_overrides`: per-dep closure overrides (keys must be present in `link_deps`)

### Supported producers (Phase 3)

For this phase, `kind:pyext` supports only:

- **C++ native libraries**: `lang:cpp` + `kind:lib` (used via `link_deps`)
- **C++ header-only targets**: `lang:cpp` + `kind:headers` (used via `header_deps`)

Wasm producers (labels like `kind:wasm` or `wasm:*`) are rejected as `link_deps` for native CPython extensions.

### Planner behavior

For a `kind:pyext` node, the Python planner:

- resolves a deterministic link closure using the shared resolver in `tools/nix/planner/link-closure.nix`
  - roots: the consumer’s `link_deps` (in order)
  - traversal: follows `link_deps` on producer nodes
  - each dep appears at most once (first occurrence wins)
- materializes in-repo native inputs:
  - each resolved `lang:cpp kind:lib` dep becomes a `T.cppLib` derivation and is passed to `T.pyExt` for linking
  - each `lang:cpp kind:headers` dep becomes a `T.cppHeaders` derivation and contributes include roots (`$out/include`) to `T.pyExt`

When an unsupported target appears in `link_deps`/`header_deps`, the planner fails fast with an actionable error that names the expected stamps.

## Open questions (explicitly deferred)

- **Buck runtime**: if we want `buck2 test` to import native modules directly, we’ll need a runfiles / `sys.path` contract for extension artifacts in Buck’s Python rules.
- **Multiple Python versions**: if the repo ever supports multiple Python versions per importer, the pinned interpreter boundary must be made explicit.
