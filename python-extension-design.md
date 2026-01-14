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

## Nix realization contract

### `T.pyExt`

`T.pyExt` produces an overlay with exactly one responsibility: an importable extension module under `$out/site`.

- **output path**: `$out/site/<module path>${EXT_SUFFIX}`
- **example**: `demo._native` → `$out/site/demo/_native${EXT_SUFFIX}`

The `EXT_SUFFIX` is derived from the pinned interpreter at build time (via `sysconfig`) to avoid hardcoding CPython tags.

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

## Open questions (explicitly deferred)

- **Buck runtime**: if we want `buck2 test` to import native modules directly, we’ll need a runfiles / `sys.path` contract for extension artifacts in Buck’s Python rules.
- **Multiple Python versions**: if the repo ever supports multiple Python versions per importer, the pinned interpreter boundary must be made explicit.
