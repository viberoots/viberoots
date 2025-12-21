load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test", "genrule")
load(
    "//lang:defs_common.bzl",
    "append_nixpkg_labels",
    "dedupe_preserve",
    "merge_provider_edges",
    "prepare_importer_non_genrule_wiring",
    "stamp_wasm_variant",
    "synthetic_dep_for_importer_patches_from_labels",
)
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_python_library(name, lockfile_label = None, deps = [], **kwargs):
    """
    Thin macro over python_library that:
    - appends nixpkg labels for native deps
    - delegates importer-scoped wiring (lockfile enforcement, stamping, patch inputs, provider edges)
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "lib",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(deps = wiring["deps"], **wiring["kwargs"])

def nix_python_binary(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "bin",
        lockfile_label = lockfile_label,
        patch_into = None,
        MODULE_PROVIDERS = {},
    )
    # Buck prelude python_binary does not accept `srcs`. We carry patch inputs via a tiny
    # synthetic python_library dep so patch edits still invalidate this binary deterministically.
    if "srcs" in wiring["kwargs"]:
        fail("nix_python_binary does not accept srcs; use main/main_module + deps instead")
    patch_dep = synthetic_dep_for_importer_patches_from_labels(
        parent_name = name,
        labels = (wiring["kwargs"].get("labels", []) or []),
        lang = "python",
        into = "resources",
    )
    python_library(**patch_dep.kwargs)
    deps = merge_provider_edges(name, (list(wiring["deps"]) + [patch_dep.dep]), MODULE_PROVIDERS = MODULE_PROVIDERS)
    python_binary(deps = deps, **wiring["kwargs"])

def nix_python_test(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "test",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_test(deps = wiring["deps"], **wiring["kwargs"])

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI app stamp: uses python_* rules for Buck semantics but marks kind:wasm for the planner.
    """
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "wasm",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    stamp_wasm_variant(wiring["kwargs"], "python", "wasi")
    python_library(deps = wiring["deps"], **wiring["kwargs"])

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI lib stamp: emits a reusable overlay (planner builds via pyWasmLib).
    """
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "wasm",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    stamp_wasm_variant(wiring["kwargs"], "python", "wasi")
    python_library(deps = wiring["deps"], **wiring["kwargs"])


