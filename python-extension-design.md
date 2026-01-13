# Python native extension modules (in-repo) — design

This document proposes a minimal design to add Buck macros for **in-repo Python native extension modules** (CPython extension modules built from C/C++ and imported from Python).

I wrote this to be consistent with:

- `lang-design-docs/python-design.md` (Python is importer-scoped, uv.lock-based, Nix builds, patching via importer-local patches)
- `cpp-plan.md` (C++ is a planner language with Nix templates, stable ordering, and clear cross-language interop boundaries)
- the quad-alignment series, especially:
  - importer-scoped wiring helpers (`//lang:importer_wiring.bzl`)
  - “srcs-less rule shapes” patterns and policy centralization (for Python binaries today)
  - provider sync driver policy hardening for importer-scoped ecosystems

## Scope

This design is about **in-repo extension modules**, not third-party Python packages that happen to contain extensions.

It targets:

- an in-repo target that produces an importable CPython extension module (a `.so` or `.dylib` with CPython’s extension suffix)
- integration into **Nix-built Python environments** produced by the existing Python planner/templates, so the module is importable at runtime
- deterministic invalidation and impact analysis through the Buck graph and existing importer-scoped wiring

## Non-goals

- Full generality for every packaging backend edge case. The extension module is built as a repository artifact, not as a wheel builder for arbitrary projects.
- Supporting Python WASM targets (WASI/Pyodide) for native extensions. These backends are explicitly “pure Python only” today.
- Solving every ABI compatibility story (abi3, manylinux tags, cross-Python builds). This design focuses on “build for the interpreter we run”.

## Current state (what I am building on)

These are already present in the repo:

- Python is a planner language:
  - `tools/nix/planner/python.nix` routes `pyApp`/`pyLib` and WASM variants.
- Python Nix template:
  - `tools/nix/templates/python.nix` builds Python app/lib derivations via a uv backend and supports importer-local patches and dev overrides.
- uv backend and adapter:
  - `tools/nix/templates/python/backends/uv.nix` delegates to `tools/nix/uv2nix-adapter.nix`.
  - The adapter produces `$out/site` and a runnable wrapper under `$out/bin/*`.
- Importer-scoped wiring utilities:
  - `python/defs.bzl` already routes through `prepare_importer_non_genrule_wiring(...)` and `append_nixpkg_labels(...)`.
  - quad-alignment documents a shared helper surface for importer-scoped wiring and srcs-less rule shapes.
- C++ Nix helper utilities:
  - `tools/nix/templates/cpp-common.nix` already centralizes deterministic flag ordering and nixpkgs include/lib flag assembly.

## Desired user experience

In `TARGETS`, I want to be able to write:

- a Python extension module target that compiles and links C/C++ sources
- a Python app/lib target that depends on it
- building the app/lib via the Python planner yields an environment where `import mypkg._native` works

## Macro surface (Buck)

### `nix_python_extension_module`

I propose adding a macro in `python/defs.bzl`:

`nix_python_extension_module(name, module, srcs, headers = [], deps = [], nixpkg_deps = [], cflags = [], ldflags = [], link_deps = [], header_deps = [], link_closure = "direct", link_closure_overrides = {}, lockfile_label = None, visibility = [...])`

Key points:

- `module` is the Python import name, for example `"mypkg._native"`.
- `srcs` includes C/C++ sources (and optionally `.c` or `.cc`).
- `headers` is optional and helps build tooling and patch invalidation.
- `nixpkg_deps` is the primary way to request native libraries/tooling (consistent with Python and C++ today).
- `link_deps` and `header_deps` allow linking to in-repo native libraries using the same semantic model as `cpp-linking.md`:
  - macro computes `deps := deps ∪ link_deps ∪ header_deps` deterministically
  - the planner decides direct vs transitive closure when materializing link inputs (see below)

Lockfile behavior:

- This is still a Python-importer-scoped target. It must enforce the same `lockfile:<path>#<importer>` labeling contract.
- I will route it through the existing importer-scoped wiring helper surface (`prepare_importer_non_genrule_wiring(...)` or the newer `//lang:importer_wiring.bzl` boundary described in quad-alignment), so:
  - lockfile labels are validated consistently
  - patch inputs and provider edges are attached consistently
  - `nixpkg:` labels are appended via `append_nixpkg_labels(...)`

### Why a Python macro (not a C++ macro)

I want the extension module to live with the Python importer and inherit importer-scoped policy:

- lockfile label enforcement
- importer-local patch inputs
- Python groups/variants (future)

The implementation can still reuse C++ Nix compilation helpers.

## Planner and template integration

### New planner kind: `pyext`

I propose that `nix_python_extension_module` stamps:

- `lang:python`
- `kind:pyext`

Then:

- `tools/nix/planner/python.nix` recognizes `kind:pyext` and can construct a derivation for it.

### New Nix template: `pyExt`

I propose a new Nix template function:

- `T.pyExt { name, module, srcRoot, subdir, srcList, headersList, nixCxxAttrs, nixCxxPkgs, pythonPkgs ? pkgs.python3, ... }`

Artifact contract:

- The derivation outputs a directory containing the compiled extension module at a stable path:
  - `$out/site/<module path><EXT_SUFFIX>`
  - Example: module `mypkg._native` becomes `$out/site/mypkg/_native${EXT_SUFFIX}`

The template must compute `EXT_SUFFIX` using the interpreter used at runtime, for example:

- `python -c 'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX"))'`

This avoids hardcoding CPython version tags.

### Python app/lib templates include extension modules

I propose extending `tools/nix/templates/python.nix` and the uv adapter integration so `pyApp` and `pyLib` can accept:

- `nativeModuleOverlays = [ <pyExt derivation> ... ]`

Then `uv2nix-adapter.nix` (or a thin wrapper above it) copies each overlay’s `$out/site/**` into the final app/lib `$out/site/**` deterministically.

This composes cleanly with the existing pattern already used for Python WASI apps:

- `tools/nix/planner/python.nix` already collects direct Python lib deps and passes them as overlays for WASI (`libOverlays`).

I am applying the same shape for native Python apps/libs:

- python app/lib depends on extension module targets
- planner collects them and passes them as overlays to the template

## Linking model for extension modules

Extension modules need native compilation and linking. I want to reuse existing utilities and keep semantics explicit.

### Inputs

An extension module can depend on:

- nixpkgs libraries and headers (via `nixpkg_deps` stamped as `nixpkg:*`)
- in-repo native libraries (C++ static libs, Go c-archives)

### In-repo native deps

I propose to reuse the same conceptual dependency model described in `cpp-linking.md`:

- `link_deps`: libraries that must be linked into the extension module
- `header_deps`: deps that provide headers/includes only
- `link_closure`: `"direct"` or `"transitive"` at the _consumer_ (the extension module) when materializing the link closure
- optional per-dep closure overrides (`link_closure_overrides`) if needed later

The extension module Nix template should accept a list of Nix package inputs for linking, analogous to C++ `nixCxxPkgs`:

- in-repo C++ libs become Nix packages via `T.cppLib`
- Go c-archives become Nix packages via `T.goCArchive` (already exists for C++ consumers)

Shared helper opportunity:

- The same “deterministic link closure resolution” helper described in `cpp-linking.md` and `wasm-linking.md` should be reusable here as well.

## Implementation sequence

See `linking-roadmap.md` for a proposed order that implements shared primitives once and then applies them across native C++, Wasm, and Python extension modules.

## Example call sites

### 1) C++ library used by the extension module

```python
# libs/native/TARGETS
load("//cpp:defs.bzl", "nix_cpp_library")

nix_cpp_library(
    name = "native_core",
    srcs = glob(["src/**/*.cpp"]),
    headers = glob(["include/**/*.h"]),
    visibility = ["PUBLIC"],
)
```

### 2) Python extension module linking the C++ library

```python
# apps/pyapp/TARGETS
load("//python:defs.bzl", "nix_python_extension_module", "nix_python_binary")

nix_python_extension_module(
    name = "native_ext",
    module = "pyapp._native",
    srcs = ["native/pyext.cc"],
    headers = ["native/pyext.h"],
    link_deps = ["//libs/native:native_core"],
    lockfile_label = "lockfile:apps/pyapp/uv.lock#apps/pyapp",
    visibility = ["PUBLIC"],
)
```

### 3) Python app depending on the extension module (planner-built runtime)

```python
# apps/pyapp/TARGETS
load("//python:defs.bzl", "nix_python_binary")

nix_python_binary(
    name = "pyapp",
    main = "bin/__main__.py",
    deps = [
        ":native_ext",
        ":pyapp_lib",
    ],
    lockfile_label = "lockfile:apps/pyapp/uv.lock#apps/pyapp",
    visibility = ["PUBLIC"],
)
```

Runtime expectation (Nix-built app):

- `T.pyApp` output includes:
  - Python site-packages from uv2nix
  - `pyapp/_native${EXT_SUFFIX}` copied from the extension overlay
- The wrapper sets `PYTHONPATH` to include `$out/site` and the app’s `src/` directory (already done by `uv2nix-adapter.nix`).

### 4) Python library depending on an extension module

```python
# libs/py-lib/TARGETS
load("//python:defs.bzl", "nix_python_library", "nix_python_extension_module")

nix_python_extension_module(
    name = "native_ext",
    module = "pylib._native",
    srcs = ["native/pyext.cc"],
    lockfile_label = "lockfile:libs/py-lib/uv.lock#libs/py-lib",
    visibility = ["PUBLIC"],
)

nix_python_library(
    name = "pylib_lib",
    srcs = glob(["src/**/*.py"]),
    deps = [":native_ext"],
    lockfile_label = "lockfile:libs/py-lib/uv.lock#libs/py-lib",
    visibility = ["PUBLIC"],
)
```

### 5) Python WASM targets

⚠️ Native extension modules are out of scope for Python WASI/Pyodide targets in this repo today. Those backends are intentionally “pure Python only”.

## Determinism and invalidation

I want extension builds to be invalidated by the same inputs as the Python importer environment, plus the extension’s own sources:

- extension sources and headers
- importer `uv.lock`
- importer-local Python patches (because they affect the environment used by the app/lib)
- `flake.lock` and relevant overlays (already treated as global Nix inputs in our system)
- nixpkgs native inputs requested via `nixpkg_deps`

I will reuse:

- `append_nixpkg_labels(...)` in `python/defs.bzl` to stamp `nixpkg:` labels
- existing global Nix input wiring policy from `build-system-design.md`

## Phased rollout (ordered, with acceptance criteria)

### Phase 0: Contracts and plumbing

Scope:

- finalize macro API and labels (`kind:pyext`)
- ensure exporter includes required attrs for the extension node (notably `module` and any link intent lists)

Acceptance:

- graph export includes the extension node with:
  - `srcs`
  - `labels` (`lang:python`, `kind:pyext`)
  - `module` string
  - `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`
  - `cflags`, `ldflags`

### Phase 1: Nix build of extension module and app integration

Scope:

- add `T.pyExt` template that produces `$out/site/<module path>${EXT_SUFFIX}`
- extend `T.pyApp` and `T.pyLib` to accept and merge `nativeModuleOverlays`
- update python planner to collect direct `kind:pyext` deps and pass overlays

Acceptance:

- a toy app importing the extension runs via the Nix-built wrapper
- a toy lib depending on an extension is importable via the Nix-built environment

### Phase 2: In-repo native linking support

Scope:

- allow extension modules to declare `link_deps` and `header_deps` and link against:
  - in-repo C++ libs (`T.cppLib`)
  - Go c-archives (`T.goCArchive`) if needed
- reuse deterministic link closure helper from `cpp-linking.md` / `wasm-linking.md` instead of inventing a new traversal

Acceptance:

- extension module links an in-repo C++ library and imports successfully at runtime

### Phase 3: Build-time Python deps from uv environment (optional)

Many extensions need Python packages at build time (headers from numpy, pybind11, etc).

Scope:

- use the existing `pyWheelhouse` facility in `tools/nix/templates/python.nix` (keyed by lockfile + patches) as an input to extension builds
- plumb a minimal contract in uv2nix adapter so extension builds can reference build requirements from the wheelhouse environment deterministically

Acceptance:

- a minimal extension build that depends on a Python package-provided header (from the lockfile) succeeds reproducibly

## Open questions and uncertainties

⚠️ Buck execution of Python tests/binaries with native extensions:

- This design prioritizes Nix-built Python runtimes (planner outputs). If we need `buck2 test` on `python_test` to import native modules directly, we will need an explicit runfiles/sys.path contract for extension files in Buck’s Python rules.
- I have not verified whether our prelude `python_library` supports a first-class “native extension” attribute. I did not find usage in this repo.

⚠️ Python version and ABI:

- The extension suffix is derived from the interpreter used in the Nix environment. This must match the interpreter used to run the app wrapper.
- If we later support multiple Python versions per repo, this needs an explicit pin at the importer boundary.

⚠️ Windows:

- Out of scope (repo targets Darwin/Linux).
