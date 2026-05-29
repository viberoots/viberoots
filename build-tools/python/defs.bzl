load(
    "//build-tools/lang:defs_common.bzl",
    "append_nixpkg_labels",
    "merge_link_intent_deps",
    "prepare_language_wiring",
    "validate_link_closure_overrides",
)
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/python:defs_lockfile.bzl", "apply_default_lockfile_label")
load("//build-tools/python/private:nix_build.bzl", "python_nix_build", "python_nix_pyext_build")
load("//build-tools/python/private:nix_test.bzl", "python_nix_test")
load(
    "//build-tools/python:defs_pyext_wasm.bzl",
    _nix_python_wasm_extension_module = "nix_python_wasm_extension_module",
)
load(
    "//build-tools/python:defs_wasm.bzl",
    _nix_python_wasm_app = "nix_python_wasm_app",
    _nix_python_wasm_lib = "nix_python_wasm_lib",
)
def nix_python_library(name, lockfile_label = None, deps = [], **kwargs):
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    lockfile_label = apply_default_lockfile_label(
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
    lockfile_label = apply_default_lockfile_label(
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
    lockfile_label = apply_default_lockfile_label(
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
    attrs = {
        "name": name,
        "out": name + ".stamp",
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "srcs": prepared.get("srcs", []) or [],
        "nix_inputs": prepared.get("nix_inputs", []) or [],
        "labels": prepared.get("labels", []) or [],
        "test_rule_timeout_ms": 30 * 60 * 1000,
        "visibility": prepared.get("visibility", []),
    }
    if "remote_execution" in prepared:
        attrs["remote_execution"] = prepared["remote_execution"]
    python_nix_test(**attrs)
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
    lockfile_label = apply_default_lockfile_label(
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
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    python_nix_pyext_build(
        name = name,
        out = name + ".stamp",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        module = prepared.get("module", ""),
        link_deps = prepared.get("link_deps", []) or [],
        header_deps = prepared.get("header_deps", []) or [],
        link_closure = prepared.get("link_closure", "direct"),
        link_closure_overrides = prepared.get("link_closure_overrides", {}),
        cflags = prepared.get("cflags", []) or [],
        ldflags = prepared.get("ldflags", []) or [],
        build_py_deps = prepared.get("build_py_deps", []) or [],
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )

def nix_python_wasm_extension_module(*args, **kwargs):
    return _nix_python_wasm_extension_module(*args, **kwargs)

def nix_python_wasm_app(*args, **kwargs):
    return _nix_python_wasm_app(*args, **kwargs)

def nix_python_wasm_lib(*args, **kwargs):
    return _nix_python_wasm_lib(*args, **kwargs)
__all__ = [
    "nix_python_binary",
    "nix_python_extension_module",
    "nix_python_library",
    "nix_python_test",
    "nix_python_wasm_app",
    "nix_python_wasm_extension_module",
    "nix_python_wasm_lib",
]
