load(
    "//lang:defs_common.bzl",
    "merge_link_intent_deps",
    "prepare_language_wiring",
    "validate_link_closure_overrides",
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
        link_deps = [],
        header_deps = [],
        link_closure = "direct",
        link_closure_overrides = None,
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

    if link_closure_overrides == None:
        link_closure_overrides = {}

    validate_link_closure_overrides(link_deps, link_closure_overrides)

    kw["module"] = module
    kw["cflags"] = cflags or []
    kw["ldflags"] = ldflags or []
    kw["build_py_deps"] = build_py_deps or []
    kw["link_deps"] = link_deps or []
    kw["header_deps"] = header_deps or []
    kw["link_closure"] = link_closure or "direct"
    kw["link_closure_overrides"] = link_closure_overrides
    kw["srcs"] = list(srcs or []) + list(headers or [])

    merged = merge_link_intent_deps(deps, kw["link_deps"], kw["header_deps"])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = merged,
        lang = "python",
        kind = "pyext_wasm",
        labels = extra_labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule",
    )
    python_pyext_stub(deps = wiring.deps, **wiring.kwargs)

__all__ = [
    "nix_python_wasm_extension_module",
]

