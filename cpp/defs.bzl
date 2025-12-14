load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels", "append_nixpkg_labels", "include_package_local_patches", "dedupe_preserve", "stamp_wasm_variant", "realize_provider_edges", "default_package_patch_dirs", "strip_provider_targets")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:planner_stub.bzl", "planner_stub")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//cpp/private:nix_test.bzl", "cpp_nix_test")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _cpp_common(name, kind, kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", default_package_patch_dirs("cpp"))
    if "nix_cxx_attrs" in kwargs:
        fail("nix_cxx_attrs is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    deps = kwargs.pop("deps", [])
    nix_inputs = global_nix_inputs()

    stamp_labels(kwargs, "cpp", kind)
    if kind == "addon":
        addon_name = kwargs.pop("addon_name", None)
        if addon_name:
            kwargs["labels"] = dedupe_preserve((kwargs.get("labels", []) or []) + ["addon_name:%s" % addon_name])
    include_package_local_patches(kwargs, "cpp", local_patch_dirs)
    srcs = kwargs.get("srcs", []) or []
    append_nixpkg_labels(kwargs, nixpkg_deps)
    deps = realize_provider_edges(MODULE_PROVIDERS, name, base = deps)

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
        deps = deps,
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
    local_patch_dirs = kwargs.pop("local_patch_dirs", default_package_patch_dirs("cpp"))
    if "nix_cxx_attrs" in kwargs:
        fail("nix_cxx_attrs is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    deps = kwargs.pop("deps", [])
    nix_inputs = global_nix_inputs()
    # Uniform WASM labeling across languages
    stamp_wasm_variant(kwargs, "cpp", "static")
    include_package_local_patches(kwargs, "cpp", local_patch_dirs)
    srcs = kwargs.get("srcs", []) or []
    append_nixpkg_labels(kwargs, nixpkg_deps)
    deps = realize_provider_edges(MODULE_PROVIDERS, name, base = deps)
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps,
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
    labels = kwargs.get("labels", []) or []
    # Use a minimal planner stub that exposes graph edges and labels
    planner_stub(
        name = name,
        out = name + ".stamp",
        deps = deps,
        labels = labels,
    )

def nix_cpp_binary(name, **kwargs):
    _cpp_common(name, "bin", kwargs)


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    if "nix_cxx_attrs" in kwargs:
        fail("nix_cxx_attrs is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    srcs = kwargs.get("srcs", [])
    planner_name = name + "__planner"
    # Planner-visible: stamps labels and wires providers so exporter->planner can generate the Nix derivation
    _planner_kwargs = dict(kwargs)
    stamp_labels(_planner_kwargs, "cpp", "test")
    # Add direct call-site attrs as nixpkg labels (shared helper)
    append_nixpkg_labels(_planner_kwargs, nixpkg_deps)
    _planner_labels = (_planner_kwargs.get("labels", []) or [])
    # Planner-visible stub: declare a cxx_library without compiling test sources; Nix will build the test.
    # Filter provider deps from planner to avoid visibility / graph-edge to providers
    _planner_deps = strip_provider_targets(deps)

    planner_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        # Graph edges for planner discovery
        deps = _planner_deps,
        # labels carry nixpkg attrs for the planner in the exported graph
        labels = _planner_labels,
    )
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    cpp_nix_test(
        name = name,
        out = name + ".stamp",
        planner_label = "//%s:%s" % (native.package_name(), planner_name),
        planner = ":%s" % planner_name,
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

