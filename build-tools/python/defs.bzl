load("@prelude//:rules.bzl", "python_library")
load(
    "//build-tools/lang:defs_common.bzl",
    "append_nixpkg_labels",
    "default_lockfile_label_from_package",
    "default_lockfile_path_from_package",
    "ensure_default_lockfile_exists",
    "extract_lockfile_labels",
    "merge_link_intent_deps",
    "prepare_language_wiring",
    "stamp_wasm_variant",
    "validate_link_closure_overrides",
)
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/python:pyext_stub.bzl", "python_pyext_stub")
load("//build-tools/python/private:nix_build.bzl", "python_nix_build")
load("//build-tools/python/private:nix_test.bzl", "python_nix_test")
load(
    "//build-tools/python:defs_pyext_wasm.bzl",
    _nix_python_wasm_extension_module = "nix_python_wasm_extension_module",
)
def _apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package(lang = "python")
        ensure_default_lockfile_exists(default_path, macro_name, lang = "python")
        return default_lockfile_label_from_package(lang = "python")
    return lockfile_label
def nix_python_library(name, lockfile_label = None, deps = [], **kwargs):
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        kwargs.get("labels", []) or [],
        "nix_python_library",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "lib",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    python_nix_build(
        name = name,
        out = name + ".stamp",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
def nix_python_binary(name, lockfile_label = None, deps = [], **kwargs):
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    if "srcs" in kwargs:
        fail("nix_python_binary does not accept srcs; use main/main_module + deps instead")
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        kwargs.get("labels", []) or [],
        "nix_python_binary",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "bin",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    srcs = list(prepared.get("srcs", []) or [])
    main_src = prepared.get("main")
    if isinstance(main_src, str) and main_src and main_src not in srcs:
        srcs.append(main_src)
    python_nix_build(
        name = name,
        out = name,
        kind = "bin",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = srcs,
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
def nix_python_test(name, lockfile_label = None, deps = [], **kwargs):
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        kwargs.get("labels", []) or [],
        "nix_python_test",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "test",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    python_nix_test(
        name = name,
        out = name + ".stamp",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
def nix_python_extension_module(
        name,
        module,
        srcs,
        headers = [],
        lockfile_label = None,
        deps = [],
        nixpkg_deps = [],
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
    if link_closure_overrides == None:
        link_closure_overrides = {}

    kw = dict(kwargs)
    append_nixpkg_labels(kw, nixpkg_deps)
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        kw.get("labels", []) or [],
        "nix_python_extension_module",
    )

    kw["module"] = module
    kw["link_deps"] = link_deps or []
    kw["header_deps"] = header_deps or []
    kw["link_closure"] = link_closure or "direct"
    kw["link_closure_overrides"] = link_closure_overrides
    kw["cflags"] = cflags or []
    kw["ldflags"] = ldflags or []
    kw["build_py_deps"] = build_py_deps or []

    kw["srcs"] = list(srcs or []) + list(headers or [])

    merged = merge_link_intent_deps(deps, kw["link_deps"], kw["header_deps"])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = merged,
        lang = "python",
        kind = "pyext",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule",
    )
    python_pyext_stub(deps = wiring.deps, **wiring.kwargs)

def nix_python_wasm_extension_module(*args, **kwargs):
    return _nix_python_wasm_extension_module(*args, **kwargs)

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    kw = dict(kwargs)
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        (kw.get("labels", []) or []) + (labels or []),
        "nix_python_wasm_app",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule",
    )
    python_library(deps = wiring.deps, **wiring.kwargs)

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    kw = dict(kwargs)
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    lockfile_label = _apply_default_lockfile_label(
        lockfile_label,
        (kw.get("labels", []) or []) + (labels or []),
        "nix_python_wasm_lib",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule",
    )
    python_library(deps = wiring.deps, **wiring.kwargs)
__all__ = [
    "nix_python_binary",
    "nix_python_extension_module",
    "nix_python_library",
    "nix_python_test",
    "nix_python_wasm_app",
    "nix_python_wasm_extension_module",
    "nix_python_wasm_lib",
]
