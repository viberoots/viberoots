## Python WASM (WASI) — Minimal Usage

This repository provides a minimal, deterministic WASI baseline for Python:

- Build a WASI app or lib with importer‑scoped `uv.lock` and optional patches in `patches/python/*.patch`.
- The WASI baseline materializes a pure‑Python site and emits a tiny WASI module that prints a banner at startup. It is designed to be small, fast, and fully offline for CI.

### Targets

- `nix_python_wasm_app(name, lockfile_label, deps = [])`
- `nix_python_wasm_lib(name, lockfile_label)`

Both macros stamp `lang:python` and `kind:wasm` so the planner routes to WASI templates.

### Expectations and Constraints

- Pure‑Python only (no native C‑extensions) for the initial baseline.
- Lockfile: `uv.lock` at the importer root; use importer‑scoped labels like `lockfile:apps/tool/uv.lock#apps/tool`.
- Patches: flat directory `patches/python/<dist>@<version>.patch`. Re‑applying an identical patch is a no‑op.
- Runner: a tiny Node `node:wasi` loader is emitted at `<out>/bin/run.mjs` for convenience.

### Example

In `apps/pywasm/TARGETS`:

```starlark
load("//python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
)
```

Build the selected target’s WASI output via the planner:

```bash
node tools/buck/export-graph.ts
BUCK_TARGET=//apps/pywasm:pyapp nix build .#graph-generator.selected
node result/bin/run.mjs
```

You should see a banner like:

```
python-wasi:wasi overlays=0 patched=none
```

Patching `hello@1.0.0` under `patches/python/` and rebuilding updates the banner to reflect the applied patch.

### Optional size trimming (opt-in)

You can enable deterministic bundle slimming via labels on your WASM targets:

- `trim:safe` removes `__pycache__`, `*.pyc/*.pyo`, and common test folders (`tests/`, `testing/`, `test/`).
- `trim:aggressive` applies the safe trims and also removes top-level `*.dist-info/`, `docs/`, and metadata files (`METADATA`, `RECORD`, `INSTALLER`, `WHEEL`) under the `site/` tree.

Example:

```starlark
load("//python:defs.bzl", "nix_python_wasm_app")

nix_python_wasm_app(
    name = "pyapp",
    lockfile_label = "lockfile:apps/pywasm/uv.lock#apps/pywasm",
    labels = ["trim:safe"],  # or "trim:aggressive"
)
```

Notes:

- Trimming affects only the realized `site/` content; planner/cache keys include the trim mode.
- Trimming is optional and disabled by default (`trim:none`).
