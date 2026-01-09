load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load(
    "//lang:defs_common.bzl",
    "dedupe_preserve",
    "normalize_labels",
    "prepare_package_local_wiring",
    "prepare_package_local_wasm_wiring",
    "wire_package_local_planner_visible_stub",
    "wire_package_local_wasm_planner_visible_stub",
)
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//cpp/private:nix_test.bzl", "cpp_nix_test")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def _cpp_common(name, kind, kwargs):
    nix_inputs = global_nix_inputs()
    kw = dict(kwargs)
    base_deps = kw.pop("deps", []) or []
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []) or [])
    base_deps = base_deps + extra
    labels = kw.get("labels", []) or []
    if kind == "addon":
        addon_name = kw.get("addon_name", None)
        if addon_name:
            labels = dedupe_preserve(labels + ["addon_name:%s" % addon_name])
    kw["labels"] = labels

    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = base_deps,
    )
    prepared = wiring.kwargs
    srcs = prepared.get("srcs", []) or []

    out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name))
    if kind == "lib":
        out = out + ".a"
    elif kind == "addon":
        out = out + ".node"

    cpp_nix_build(
        name = name,
        out = out,
        kind = kind,
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = srcs,
        labels = prepared.get("labels", []) or [],
        nix_inputs = nix_inputs,
        visibility = prepared.get("visibility", []),
    )


def nix_cpp_library(name, **kwargs):
    _cpp_common(name, "lib", kwargs)

def nix_cpp_wasm_static_lib(name, **kwargs):
    """
    Build a wasm-targeted static library via the Nix planner (cppWasmStaticLib).

    Stamps:
      - lang:cpp, kind:lib, flavor:wasm
    """
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    nix_inputs = global_nix_inputs()
    wiring = prepare_package_local_wasm_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        variant = "static",
        deps = deps,
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

def nix_cpp_binary(name, **kwargs):
    _cpp_common(name, "bin", kwargs)

def nix_cpp_headers(name, **kwargs):
    # Planner-visible header-only target. This produces no linkable artifact; the planner
    # materializes a derivation with an include tree via T.cppHeaders.
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    srcs = kw.get("srcs", []) or []
    wire_package_local_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        kind = "headers",
        deps = deps,
        srcs = srcs,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    planner_name = name + "__planner"
    # Planner-visible stub: Nix builds the test; this node exists for planner discovery and invalidation.
    # Provider deps are stripped to avoid visibility / graph-shape problems on the planner-visible boundary.
    wire_package_local_planner_visible_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        kind = "test",
        deps = deps,
        srcs = [],
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    cpp_nix_test(
        name = name,
        out = name + ".stamp",
        planner_label = "//%s:%s" % (native.package_name(), planner_name),
        planner = ":%s" % planner_name,
        nix_inputs = global_nix_inputs(),
    )


def cpp_sanitize_probe(name, label):
    _cpp_sanitize_probe(name = name, label = label)

def nix_cpp_node_addon(name, **kwargs):
    # Node-API addon producing a .node shared library via the Nix planner.
    #
    # Contract:
    # - This macro stamps labels ["lang:cpp", "kind:addon"] and includes local patch dirs
    #   in srcs so patch edits precisely invalidate reverse deps.
    # - addon_name (optional) is recorded as a non-functional label "addon_name:<name>"
    #   to aid planner tooling and documentation. It does not change the build artifact
    #   filename selected here.
    # - The build artifact is a single ".node" shared library. Downstream Node packaging
    #   should copy/rename this artifact to a stable runtime path such as
    #   "native/<addon_name or sanitized target name>.node" for loading from JS/TS.
    _cpp_common(name, "addon", kwargs)

__all__ = [
    "nix_cpp_library",
    "nix_cpp_wasm_static_lib",
    "nix_cpp_wasm_emscripten_lib",
    "nix_cpp_binary",
    "nix_cpp_headers",
    "nix_cpp_test",
    "nix_cpp_node_addon",
    "cpp_sanitize_probe",
]

