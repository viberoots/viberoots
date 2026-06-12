## Python WASM (WASI) — Minimal Usage

This repository provides a deterministic WASI runtime for Python:

- Build a WASI app or lib with importer‑scoped `uv.lock` and optional patches in `patches/python/*.patch`.
- The WASI runtime materializes a pure‑Python site and executes `bin/__main__.py` with a pinned wasm32‑wasi CPython build. It is designed to be offline and deterministic for CI.

### Targets

- `nix_python_wasm_app(name, lockfile_label, deps = [])`
- `nix_python_wasm_lib(name, lockfile_label)`

Both macros stamp `lang:python` and `kind:wasm` so the planner routes to WASI templates.

### Expectations and Constraints

- Third‑party native C‑extensions are out of scope; in‑repo `kind:pyext_wasm` modules are **not supported** for WASI at runtime today (the pinned WASI CPython build lacks dynamic module loading). The planner fails fast if a WASI target depends on `kind:pyext_wasm` producers.
- Lockfile: `uv.lock` at the importer root; use importer‑scoped labels like `lockfile:projects/apps/tool/uv.lock#projects/apps/tool`.
- Patches: flat directory `patches/python/<dist>@<version>.patch`. Re‑applying an identical patch is a no‑op.
- Runner: a Node `node:wasi` loader is emitted at `<out>/bin/run.mjs` for convenience.
- WASI extension modules are currently not runnable; use `backend:pyodide` for `nix_python_wasm_extension_module` until the WASI runtime gains dynamic loading support.

### Example

In `apps/pywasm/TARGETS`:

```starlark
load("//build-tools/python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
)
```

Build the selected target’s WASI output via the planner:

```bash
node build-tools/tools/buck/export-graph.ts
BUCK_TARGET=//projects/apps/pywasm:pyapp nix build .#graph-generator.selected
node result/bin/run.mjs
```

You should see output that includes the runtime banner and your app output, for example:

```
python-wasi:wasi overlays=0 patched=none
hello from python app
```

Patching `hello@1.0.0` under `patches/python/` and rebuilding updates the banner to reflect the applied patch.

### Optional size trimming (opt-in)

You can enable deterministic bundle slimming via labels on your WASM targets:

- `trim:safe` removes `__pycache__`, `*.pyc/*.pyo`, and common test folders (`tests/`, `testing/`, `test/`).
- `trim:aggressive` applies the safe trims and also removes top-level `*.dist-info/`, `docs/`, and metadata files (`METADATA`, `RECORD`, `INSTALLER`, `WHEEL`) under the `site/` tree.

Example:

```starlark
load("//build-tools/python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    lockfile_label = "lockfile:projects/apps/pywasm/uv.lock#projects/apps/pywasm",
    labels = ["trim:safe"],  # or "trim:aggressive"
)
```

Notes:

- Trimming affects only the realized `site/` content; planner/cache keys include the trim mode.
- Trimming is optional and disabled by default (`trim:none`).

### Prebuild guard (glue presence & freshness)

Before builds, a prebuild guard ensures generated “glue” is present and fresh:

- Inputs include `TARGETS`, `*.bzl`, `patches/**/*.patch`, `flake.lock`, `build-tools/tools/nix/overlays/**`, and importer-scoped lockfiles: `**/pnpm-lock.yaml` for Node and `**/uv.lock` for Python.
- Freshness compares the newest input against the oldest glue output with a small allowed skew.
- Behavior:
  - Local: the guard auto-fixes by running export-graph → sync-providers → gen-auto-map.
  - CI: the guard fails if glue is stale or missing.

This means editing a Python importer’s `uv.lock` will trigger the guard to refresh providers and mappings locally, keeping Python parity with Node’s `pnpm-lock.yaml` handling.

#### Missing provider diagnostics and auto-fix (Python)

When a `uv.lock` exists but `third_party/providers/TARGETS.python.auto` does not contain the importer’s provider rule, the guard:

- CI: fails with a targeted error including the expected provider name (`lf_<hash>_...`) and importer (`<dir>`).
- Local: auto-fixes by regenerating Python providers, then re-checks and proceeds.
