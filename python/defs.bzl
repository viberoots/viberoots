load("@prelude//:rules.bzl", "python_binary", "python_library", "python_test")
load("//lang:defs_common.bzl", "stamp_labels", "ensure_single_lockfile_label", "append_nixpkg_labels", "providers_for")
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
    deps = deps + _providers_for(name)
    python_library(name = name, deps = deps, **kwargs)

def nix_python_binary(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for binaries.
    """
    stamp_labels(kwargs, "python", "bin")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    deps = deps + _providers_for(name)
    python_binary(name = name, deps = deps, **kwargs)

def nix_python_test(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    """
    See nix_python_library — identical wiring for tests.
    """
    stamp_labels(kwargs, "python", "test")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    deps = deps + _providers_for(name)
    python_test(name = name, deps = deps, **kwargs)


