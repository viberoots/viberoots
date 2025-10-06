load("@prelude//cxx:cxx.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels")

def _providers_for(name):
    MODULE_PROVIDERS = {}
    # Generated mapping; rely on prebuild-guard to ensure presence when needed
    load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_cpp_library(name, **kwargs):
    deps = kwargs.pop("deps", [])
    labels = kwargs.pop("labels", [])
    labels = stamp_labels(labels, lang = "cpp", kind = "lib")
    deps = deps + _providers_for(name)
    cxx_library(name = name, labels = labels, deps = deps, **kwargs)

def nix_cpp_binary(name, **kwargs):
    deps = kwargs.pop("deps", [])
    labels = kwargs.pop("labels", [])
    labels = stamp_labels(labels, lang = "cpp", kind = "bin")
    deps = deps + _providers_for(name)
    cxx_binary(name = name, labels = labels, deps = deps, **kwargs)

def nix_cpp_test(name, **kwargs):
    deps = kwargs.pop("deps", [])
    labels = kwargs.pop("labels", [])
    labels = stamp_labels(labels, lang = "cpp", kind = "test")
    deps = deps + _providers_for(name)
    cxx_test(name = name, labels = labels, deps = deps, **kwargs)


