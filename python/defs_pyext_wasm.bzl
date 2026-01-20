load(
    "//lang:defs_common.bzl",
    "prepare_importer_non_genrule_wiring",
)
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//python:pyext_stub.bzl", "python_pyext_stub")

_BACKEND_LABELS = ["backend:wasi", "backend:pyodide"]

def _label_list(labels):
    if labels == None:
        return []
    if not isinstance(labels, list):
        fail("labels must be a list of string labels")
    for l in labels:
        if not isinstance(l, str):
            fail("labels must be a list of string labels")
    return labels

def _require_backend_label(labels):
    backend_labels = [l for l in labels if l.startswith("backend:")]
    invalid = [l for l in backend_labels if l not in _BACKEND_LABELS]
    if len(invalid) > 0:
        fail(
            "Unsupported backend label for nix_python_wasm_extension_module: %s (supported: backend:wasi, backend:pyodide)"
            % ", ".join(invalid)
        )
    allowed = [l for l in backend_labels if l in _BACKEND_LABELS]
    if len(allowed) != 1:
        fail("Exactly one backend label is required: backend:wasi or backend:pyodide")

def nix_python_wasm_extension_module(
        name,
        module,
        srcs,
        headers = [],
        lockfile_label = None,
        deps = [],
        labels = [],
        cflags = [],
        ldflags = [],
        build_py_deps = [],
        **kwargs):
    if not module or not isinstance(module, str):
        fail("module must be a non-empty string (e.g. 'mypkg._native')")
    if not isinstance(srcs, list):
        fail("srcs must be a list")
    if headers == None:
        headers = []
    if not isinstance(headers, list):
        fail("headers must be a list")

    kw = dict(kwargs)
    base_labels = _label_list(kw.get("labels", []))
    extra_labels = _label_list(labels)
    kw["labels"] = base_labels
    _require_backend_label(base_labels + extra_labels)

    kw["module"] = module
    kw["cflags"] = cflags or []
    kw["ldflags"] = ldflags or []
    kw["build_py_deps"] = build_py_deps or []
    kw["srcs"] = list(srcs or []) + list(headers or [])

    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "pyext_wasm",
        labels = extra_labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_pyext_stub(deps = wiring.deps, **wiring.kwargs)

__all__ = [
    "nix_python_wasm_extension_module",
]

