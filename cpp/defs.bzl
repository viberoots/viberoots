load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_cpp_library(name, **kwargs):
    deps = kwargs.pop("deps", [])
    # Stamp language/kind onto kwargs["labels"] while preserving any existing labels
    stamp_labels(kwargs, "cpp", "lib")
    deps = deps + _providers_for(name)
    cxx_library(name = name, deps = deps, **kwargs)

def nix_cpp_binary(name, **kwargs):
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "bin")
    deps = deps + _providers_for(name)
    cxx_binary(name = name, deps = deps, **kwargs)

def nix_cpp_test(name, **kwargs):
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "test")
    deps = deps + _providers_for(name)
    cxx_test(name = name, deps = deps, **kwargs)


