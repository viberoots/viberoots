# //rust/defs.bzl — skeleton macros

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])


def rust_library(name, **kwargs):
    deps = kwargs.pop("deps", []) + _providers_for(name)
    native.export_file(name = name, src = "BUILD.bazel", visibility = ["//visibility:public"])  # placeholder


def rust_binary(name, **kwargs):
    deps = kwargs.pop("deps", []) + _providers_for(name)
    native.export_file(name = name, src = "BUILD.bazel", visibility = ["//visibility:public"])  # placeholder
