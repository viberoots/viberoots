load("@prelude//:rules.bzl", "python_library")
load(
    "//build-tools/lang:defs_common.bzl",
    "append_nixpkg_labels",
    "prepare_language_wiring",
    "stamp_wasm_variant",
)
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/python:defs_lockfile.bzl", "apply_default_lockfile_label")

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    kw = dict(kwargs)
    stamp_wasm_variant(kw, "python", "wasi")
    nixpkg_deps = kw.pop("nixpkg_deps", [])
    append_nixpkg_labels(kw, nixpkg_deps)
    lockfile_label = apply_default_lockfile_label(
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
    lockfile_label = apply_default_lockfile_label(
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
    "nix_python_wasm_app",
    "nix_python_wasm_lib",
]
