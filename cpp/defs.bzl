load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "dedupe_preserve", "prepare_package_local_wiring", "stamp_wasm_variant", "wire_package_local_planner_visible_stub")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:planner_stub.bzl", "planner_stub")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//cpp/private:nix_test.bzl", "cpp_nix_test")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def _cpp_common(name, kind, kwargs):
    deps = kwargs.pop("deps", [])
    nix_inputs = global_nix_inputs()

    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "cpp",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps,
    )
    if kind == "addon":
        addon_name = kwargs.pop("addon_name", None)
        if addon_name:
            kwargs["labels"] = dedupe_preserve((kwargs.get("labels", []) or []) + ["addon_name:%s" % addon_name])
    srcs = kwargs.get("srcs", []) or []

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
        labels = kwargs.get("labels", []) or [],
        nix_inputs = nix_inputs,
        visibility = kwargs.get("visibility", []),
    )


def nix_cpp_library(name, **kwargs):
    _cpp_common(name, "lib", kwargs)

def nix_cpp_wasm_static_lib(name, **kwargs):
    """
    Build a wasm-targeted static library via the Nix planner (cppWasmStaticLib).

    Stamps:
      - lang:cpp, kind:lib, flavor:wasm
    """
    deps = kwargs.pop("deps", [])
    nix_inputs = global_nix_inputs()
    # Uniform WASM labeling across languages
    stamp_wasm_variant(kwargs, "cpp", "static")
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "cpp",
        kind = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps,
        stamp = False,
    )
    srcs = kwargs.get("srcs", []) or []
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = srcs,
        labels = kwargs.get("labels", []) or [],
        nix_inputs = nix_inputs,
        visibility = kwargs.get("visibility", []),
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
    deps = kwargs.pop("deps", [])
    # Stamp language/kind and wasm variant for planner routing
    stamp_wasm_variant(kwargs, "cpp", "emscripten")

    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "cpp",
        kind = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps,
        stamp = False,
    )
    labels = kwargs.get("labels", []) or []
    srcs = kwargs.get("srcs", []) or []

    planner_stub(
        name = name,
        out = name + ".stamp",
        deps = wiring.deps,
        srcs = srcs,
        labels = labels,
        visibility = kwargs.get("visibility", []),
    )

def nix_cpp_binary(name, **kwargs):
    _cpp_common(name, "bin", kwargs)


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    planner_name = name + "__planner"
    # Planner-visible stub: Nix builds the test; this node exists for planner discovery and invalidation.
    # Provider deps are stripped to avoid visibility / graph-shape problems on the planner-visible boundary.
    _planner_kwargs = dict(kwargs)
    wire_package_local_planner_visible_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        kwargs = _planner_kwargs,
        lang = "cpp",
        kind = "test",
        deps = deps,
        srcs = [],
        strip_providers_from_deps = True,
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
    "nix_cpp_test",
    "nix_cpp_node_addon",
    "cpp_sanitize_probe",
]

