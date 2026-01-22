load(
    "//lang:defs_common.bzl",
    "merge_link_intent_deps",
    "prepare_package_local_wasm_wiring",
    "wire_package_local_wasm_planner_visible_stub",
)
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_cpp_wasm_static_lib(name, **kwargs):
    """
    Build a wasm-targeted static library via the Nix planner (cppWasmStaticLib).

    Stamps:
      - lang:cpp, kind:lib, flavor:wasm
    """
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    # Preserve normalized values for downstream tooling and for passing through to the underlying rule.
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    nix_inputs = global_nix_inputs()
    wiring = prepare_package_local_wasm_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        variant = "static",
        deps = merged,
        provider_realization_mode = "deps",
        strip_providers_from_deps = False,
    )
    prepared = wiring.kwargs
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        header_deps = prepared.get("header_deps", []) or [],
        srcs = prepared.get("srcs", []) or [],
        labels = prepared.get("labels", []) or [],
        nix_inputs = nix_inputs,
        visibility = prepared.get("visibility", []),
    )


def nix_cpp_wasm_emscripten_lib(name, **kwargs):
    """
    Planner-visible stub for an Emscripten C/C++ bundle (JS + WASM) via the Nix planner.

    Stamps:
      - lang:cpp, kind:lib, wasm:emscripten

    Note:
      This macro intentionally declares a lightweight planner stub instead of invoking
      the generic cpp_nix_build rule, because the artifact shape is a dual output
      (.js + .wasm) rather than a single .a/.node. The actual JS/WASM bundle is
      produced by the planner template (cppWasmEmscriptenLib) when built via the
      Nix flake attributes (e.g., graph-generator-selected).
    """
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    srcs = kw.get("srcs", []) or []
    wire_package_local_wasm_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        variant = "emscripten",
        deps = deps,
        srcs = srcs,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        # Preserve historical behavior for this macro: provider targets remain in deps.
        # This stub shape is used as a graph node and provider deps are part of its invalidation surface.
        provider_realization_mode = "deps",
        strip_providers_from_deps = False,
    )

__all__ = [
    "nix_cpp_wasm_static_lib",
    "nix_cpp_wasm_emscripten_lib",
]
