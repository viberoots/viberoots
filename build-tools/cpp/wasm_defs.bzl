load(
    "//build-tools/lang:defs_common.bzl",
    "dedupe_preserve",
    "merge_link_intent_deps",
    "prepare_language_wiring",
)
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/lang:module_surface.bzl", "module_surface")
load("//build-tools/cpp/private:nix_build.bzl", "cpp_nix_build")
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")

def _wasm_target_for_abi(wasm_abi):
    if wasm_abi == "wasi":
        return "wasm32-wasi"
    return "wasm32-unknown-unknown"

def _apply_wasm_abi(kw):
    wasm_abi = kw.pop("wasm_abi", "bare") or "bare"
    if wasm_abi not in ["bare", "wasi"]:
        fail("nix_cpp_wasm_static_lib: wasm_abi must be \"bare\" or \"wasi\"")
    wasm_target = _wasm_target_for_abi(wasm_abi)
    labels = kw.get("labels", []) or []
    extra = ["wasm_target:%s" % wasm_target]
    if wasm_abi == "wasi":
        extra.append("wasm:wasi")
    kw["labels"] = dedupe_preserve(labels + extra)
    return wasm_target

def nix_cpp_wasm_static_lib(name, **kwargs):
    """
    Build a wasm-targeted static library via the Nix planner (cppWasmStaticLib).

    Stamps:
      - lang:cpp, kind:lib, flavor:wasm
      - wasm:wasi when wasm_abi = "wasi" (default is bare)
      - wasm_target:<triple> derived from wasm_abi
    """
    kw = dict(kwargs)
    cpp_source_roots = kw.pop("cpp_source_roots", ["."])
    _ = _apply_wasm_abi(kw)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    # Preserve normalized values for downstream tooling and for passing through to the underlying rule.
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    nix_inputs = global_nix_inputs()
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = merged,
        wasm_variant = "static",
        wasm_provider_realization_mode = "deps",
        wasm_strip_providers_from_deps = False,
    )
    prepared = wiring.kwargs
    cpp_nix_build(
        name = name,
        out = sanitize_name("//%s:%s" % (native.package_name(), name)) + ".a",
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
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = cpp_source_roots,
        artifact_mapping_policy = "cpp-static-wasm-v1",
        watch_hints = cpp_source_roots,
        visibility = ["PUBLIC"],
    )


def nix_cpp_wasm_emscripten_lib(name, **kwargs):
    """
    Build an Emscripten C/C++ bundle (JS + WASM) via the Nix planner.

    Stamps:
      - lang:cpp, kind:lib, wasm:emscripten

    Note:
      This macro keeps a stamp output at the Buck rule boundary, while enforcing that
      the underlying Nix output contains both bundle artifacts:
      - lib/<sanitized>.js
      - lib/<sanitized>.wasm
    """
    kw = dict(kwargs)
    labels = kw.get("labels", []) or []
    # Ensure planner treats emscripten targets as libs (while still stamping kind:wasm).
    kw["labels"] = dedupe_preserve(labels + ["kind:lib"])
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = None,
        deps = merged,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wasm_variant = "emscripten",
        wasm_provider_realization_mode = "deps",
        wasm_strip_providers_from_deps = False,
    )
    prepared = wiring.kwargs
    cpp_nix_build(
        name = name,
        out = name + ".stamp",
        kind = "emscripten",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        header_deps = prepared.get("header_deps", []) or [],
        srcs = prepared.get("srcs", []) or [],
        labels = prepared.get("labels", []) or [],
        exported_functions = prepared.get("exported_functions", []) or [],
        nix_inputs = global_nix_inputs(),
        visibility = prepared.get("visibility", []),
    )

__all__ = [
    "nix_cpp_wasm_static_lib",
    "nix_cpp_wasm_emscripten_lib",
]
