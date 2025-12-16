load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test", "genrule")
load(
    "//lang:defs_common.bzl",
    "append_nixpkg_labels",
    "attach_importer_patch_inputs",
    "dedupe_preserve",
    "merge_provider_edges",
    "require_single_importer_lockfile_label",
    "stamp_labels",
    "stamp_wasm_variant",
    "synthetic_dep_for_importer_patches_from_labels",
)
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_python_library(name, lockfile_label = None, deps = [], **kwargs):
    """
    Thin macro over python_library that:
    - stamps lang/kind labels
    - enforces exactly one importer-scoped lockfile label
    - appends nixpkg labels for native deps
    - wires provider deps from MODULE_PROVIDERS
    """
    stamp_labels(kwargs, "python", "lib")
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    if "nix_native_deps" in kwargs:
        fail("nix_native_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    # Include importer-local patches in srcs so Buck invalidates precisely on patch changes
    attach_importer_patch_inputs(kwargs, "python")
    deps = merge_provider_edges(name, deps, MODULE_PROVIDERS = MODULE_PROVIDERS)
    python_library(name = name, deps = deps, **kwargs)

def nix_python_binary(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    stamp_labels(kwargs, "python", "bin")
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    if "nix_native_deps" in kwargs:
        fail("nix_native_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    # Buck prelude python_binary does not accept `srcs`. We carry patch inputs via a tiny
    # synthetic python_library dep so patch edits still invalidate this binary deterministically.
    if "srcs" in kwargs:
        fail("nix_python_binary does not accept srcs; use main/main_module + deps instead")
    patch_dep = synthetic_dep_for_importer_patches_from_labels(
        parent_name = name,
        labels = (kwargs.get("labels", []) or []),
        lang = "python",
        into = "resources",
    )
    python_library(**patch_dep.kwargs)
    deps = list(deps) + [patch_dep.dep]
    deps = merge_provider_edges(name, deps, MODULE_PROVIDERS = MODULE_PROVIDERS)
    python_binary(name = name, deps = deps, **kwargs)

def nix_python_test(name, lockfile_label = None, deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    stamp_labels(kwargs, "python", "test")
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    if "nix_native_deps" in kwargs:
        fail("nix_native_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    attach_importer_patch_inputs(kwargs, "python")
    deps = merge_provider_edges(name, deps, MODULE_PROVIDERS = MODULE_PROVIDERS)
    python_test(name = name, deps = deps, **kwargs)

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI app stamp: uses python_* rules for Buck semantics but marks kind:wasm for the planner.
    """
    # Preserve caller-provided labels then stamp uniform WASM variant (wasi)
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    stamp_wasm_variant(kwargs, "python", "wasi")
    labels = kwargs.get("labels", []) or []
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    if "nix_native_deps" in kwargs:
        fail("nix_native_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    attach_importer_patch_inputs(kwargs, "python")
    srcs = kwargs.get("srcs", []) or []
    # Expose true dependency edges so planner sees overlays via depsOf
    deps = merge_provider_edges(name, (deps or []), MODULE_PROVIDERS = MODULE_PROVIDERS)
    kwargs["srcs"] = srcs
    python_library(name = name, deps = deps, **kwargs)

def nix_python_wasm_lib(name, lockfile_label = None, deps = [], labels = [], **kwargs):
    """
    WASI lib stamp: emits a reusable overlay (planner builds via pyWasmLib).
    """
    # Preserve caller-provided labels then stamp uniform WASM variant (wasi)
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    stamp_wasm_variant(kwargs, "python", "wasi")
    labels = kwargs.get("labels", []) or []
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    if "nix_native_deps" in kwargs:
        fail("nix_native_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    append_nixpkg_labels(kwargs, nixpkg_deps)
    attach_importer_patch_inputs(kwargs, "python")
    srcs = kwargs.get("srcs", []) or []
    deps = merge_provider_edges(name, (deps or []), MODULE_PROVIDERS = MODULE_PROVIDERS)
    kwargs["srcs"] = srcs
    python_library(name = name, deps = deps, **kwargs)


