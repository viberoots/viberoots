load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test", "genrule")
load("//lang:defs_common.bzl", "stamp_labels", "ensure_single_lockfile_label", "append_nixpkg_labels", "providers_for", "include_importer_patches_from_labels", "dedupe_preserve", "stamp_wasm_variant")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _providers_for(name):
    # Generated mapping of target -> providers from auto_map.bzl
    return providers_for(MODULE_PROVIDERS, name)

def nix_python_library(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    """
    Thin macro over python_library that:
    - stamps lang/kind labels
    - enforces exactly one importer-scoped lockfile label
    - appends nixpkg labels for native deps
    - wires provider deps from MODULE_PROVIDERS
    """
    stamp_labels(kwargs, "python", "lib")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    # Include importer-local patches in srcs so Buck invalidates precisely on patch changes
    include_importer_patches_from_labels(kwargs, "python")
    deps = deps + _providers_for(name)
    python_library(name = name, deps = deps, **kwargs)

def nix_python_binary(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    stamp_labels(kwargs, "python", "bin")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    # Buck prelude python_binary does not accept `srcs`; callers should use `main`.
    if "srcs" in kwargs:
        kwargs.pop("srcs")
    include_importer_patches_from_labels(kwargs, "python")
    deps = deps + _providers_for(name)
    python_binary(name = name, deps = deps, **kwargs)

def nix_python_test(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    stamp_labels(kwargs, "python", "test")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    include_importer_patches_from_labels(kwargs, "python")
    deps = deps + _providers_for(name)
    python_test(name = name, deps = deps, **kwargs)

# WASM (WASI) convenience macros — stamp kind:wasm so planner routes to pyWasm* templates
def nix_python_wasm_app(name, lockfile_label = None, nix_native_deps = [], deps = [], labels = [], **kwargs):
    """
    WASI app stamp: uses python_* rules for Buck semantics but marks kind:wasm for the planner.
    """
    # Preserve caller-provided labels then stamp uniform WASM variant (wasi)
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    stamp_wasm_variant(kwargs, "python", "wasi")
    labels = kwargs.get("labels", []) or []
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    include_importer_patches_from_labels(kwargs, "python")
    provs = _providers_for(name)
    srcs = kwargs.get("srcs", []) or []
    # Expose true dependency edges so planner sees overlays via depsOf
    deps = dedupe_preserve((deps or []) + provs)
    kwargs["srcs"] = srcs
    python_library(name = name, deps = deps, **kwargs)

def nix_python_wasm_lib(name, lockfile_label = None, nix_native_deps = [], deps = [], labels = [], **kwargs):
    """
    WASI lib stamp: emits a reusable overlay (planner builds via pyWasmLib).
    """
    # Preserve caller-provided labels then stamp uniform WASM variant (wasi)
    kwargs["labels"] = dedupe_preserve((labels or []) + (kwargs.get("labels", []) or []))
    stamp_wasm_variant(kwargs, "python", "wasi")
    labels = kwargs.get("labels", []) or []
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    include_importer_patches_from_labels(kwargs, "python")
    provs = _providers_for(name)
    srcs = kwargs.get("srcs", []) or []
    deps = dedupe_preserve((deps or []) + provs)
    kwargs["srcs"] = srcs
    python_library(name = name, deps = deps, **kwargs)


