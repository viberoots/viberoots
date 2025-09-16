load("@prelude//go:def.bzl", "go_binary", "go_library", "go_test")

def _providers_for(name):
    fail_msg = (
        "Missing provider map. Run: `node tools/buck/gen-auto-map.ts "
        "--graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`."
    )
    MODULE_PROVIDERS = None
    try:
        load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
    except Exception as e:
        fail(fail_msg + "\nDetails: %s" % e)
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_go_library(name, **kwargs):
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_library(name = name, deps = deps, **kwargs)

def nix_go_binary(name, **kwargs):
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_binary(name = name, deps = deps, **kwargs)

def nix_go_test(name, **kwargs):
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_test(name = name, deps = deps, **kwargs)


