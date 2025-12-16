# //rust/defs.bzl — skeleton macros

load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:defs_common.bzl", "realize_provider_edges")


def _stub_rule_with_provider_edges(name, base_srcs):
    srcs = realize_provider_edges(MODULE_PROVIDERS, name, into = "srcs", base = base_srcs)
    native.genrule(
        name = name,
        srcs = srcs,
        out = name + ".stamp",
        cmd = "echo rust_stub > $OUT",
        visibility = ["//visibility:public"],
    )


def rust_library(name, **kwargs):
    base_srcs = kwargs.pop("srcs", [])
    deps = kwargs.pop("deps", [])
    _stub_rule_with_provider_edges(name, base_srcs + deps)


def rust_binary(name, **kwargs):
    base_srcs = kwargs.pop("srcs", [])
    deps = kwargs.pop("deps", [])
    _stub_rule_with_provider_edges(name, base_srcs + deps)
