load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test", "genrule")
load(
    "//lang:defs_common.bzl",
    "append_nixpkg_labels",
    "dedupe_preserve",
    "prepare_importer_non_genrule_wiring_v2",
    "prepare_importer_srcsless_rule_wiring_v2",
    "stamp_wasm_variant",
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
    wiring = prepare_importer_non_genrule_wiring_v2(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "lib",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(deps = wiring.deps, **wiring.kwargs)

def nix_python_binary(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    if "srcs" in kwargs:
        fail("nix_python_binary does not accept srcs; use main/main_module + deps instead")
    wiring = prepare_importer_srcsless_rule_wiring_v2(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "bin",
        lockfile_label = lockfile_label,
        patch_dep_into = "resources",
        patch_dep_suffix = "__patch_inputs",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_library(**wiring.patch_dep.kwargs)
    python_binary(deps = wiring.merge_deps(deps), **wiring.kwargs)

def nix_python_test(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring_v2(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "test",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    python_test(deps = wiring.deps, **wiring.kwargs)

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI app stamp: uses python_* rules for Buck semantics but marks kind:wasm for the planner.
    """
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring_v2(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "wasm",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    stamp_wasm_variant(wiring.kwargs, "python", "wasi")
    python_library(deps = wiring.deps, **wiring.kwargs)

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI lib stamp: emits a reusable overlay (planner builds via pyWasmLib).
    """
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    wiring = prepare_importer_non_genrule_wiring_v2(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = "python",
        kind = "wasm",
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    stamp_wasm_variant(wiring.kwargs, "python", "wasi")
    python_library(deps = wiring.deps, **wiring.kwargs)


