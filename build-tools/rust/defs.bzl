load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/lang:defs_common.bzl", "normalize_labels", "prepare_language_wiring")
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/rust/private:nix_build.bzl", "rust_nix_build")

def _rust_nix_target(name, kind, out, kwargs):
    kw = dict(kwargs)
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "rust",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps + extra,
    )
    prepared = wiring.kwargs
    rust_nix_build(
        name = name,
        out = out,
        kind = kind,
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = prepared.get("srcs", []) or [],
        labels = prepared.get("labels", []) or [],
        nix_inputs = global_nix_inputs(),
        visibility = prepared.get("visibility", []),
    )

def rust_library(name, **kwargs):
    _rust_nix_target(name = name, kind = "lib", out = name + ".stamp", kwargs = kwargs)

def rust_binary(name, **kwargs):
    _rust_nix_target(name = name, kind = "bin", out = name, kwargs = kwargs)

__all__ = [
    "rust_binary",
    "rust_library",
]
