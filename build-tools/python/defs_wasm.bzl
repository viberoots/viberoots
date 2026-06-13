load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "append_nixpkg_labels",
    "prepare_language_wiring",
    "stamp_wasm_variant",
)
load("@viberoots//build-tools/lang:module_surface.bzl", "module_surface")
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/python:defs_lockfile.bzl", "apply_default_lockfile_label")
load("@viberoots//build-tools/python/private:nix_build.bzl", "python_nix_wasm_build")

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    kw = dict(kwargs)
    python_source_roots = kw.pop("python_source_roots", ["."])
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    extra_labels = list(labels or []) + ["wasm:app"]
    lockfile_label = apply_default_lockfile_label(
        lockfile_label,
        (kw.get("labels", []) or []) + extra_labels,
        "nix_python_wasm_app",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = extra_labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    python_nix_wasm_build(
        name = name,
        out = name,
        kind = "wasm_app",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = python_source_roots,
        artifact_mapping_policy = "python-wasm-app-v1",
        watch_hints = python_source_roots,
        visibility = ["PUBLIC"],
    )

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    kw = dict(kwargs)
    python_source_roots = kw.pop("python_source_roots", ["."])
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    extra_labels = list(labels or []) + ["wasm:lib"]
    lockfile_label = apply_default_lockfile_label(
        lockfile_label,
        (kw.get("labels", []) or []) + extra_labels,
        "nix_python_wasm_lib",
    )
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        deps = deps,
        lang = "python",
        kind = "wasm",
        labels = extra_labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "non_genrule_nix_calling",
        global_inputs_into = "nix_inputs",
    )
    prepared = wiring.kwargs
    python_nix_wasm_build(
        name = name,
        out = name + ".stamp",
        kind = "wasm_lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = prepared.get("nix_inputs", []) or [],
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = python_source_roots,
        artifact_mapping_policy = "python-wasm-lib-v1",
        watch_hints = python_source_roots,
        visibility = ["PUBLIC"],
    )

__all__ = [
    "nix_python_wasm_app",
    "nix_python_wasm_lib",
]
