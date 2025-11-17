load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels", "append_nixpkg_labels", "append_patch_srcs", "providers_for", "dedupe_preserve")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//cpp/private:planner_stub.bzl", "cpp_planner_stub")
load("//cpp/private:nix_test.bzl", "cpp_nix_test")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def nix_cpp_library(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/cpp"])  # per-target local patch directories
    nix_cxx_attrs = kwargs.pop("nix_cxx_attrs", [])
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    # Explicit Nix-level inputs that should affect the rule key.
    # We conservatively include repo-level flake.lock and the shared C++ overlay.
    # These are source file labels at the repo root and tools/nix/overlays package.
    nix_inputs = ["//:flake.lock", "//tools/nix/overlays:cpp-patches.nix"]
    stamp_labels(kwargs, "cpp", "lib")
    # Include local patch files in rule inputs so Buck invalidates on patch changes
    append_patch_srcs(kwargs, local_patch_dirs)
    srcs = kwargs.get("srcs", []) or []
    append_nixpkg_labels(kwargs, nix_cxx_attrs)
    # Realize provider edges for diagnostics/introspection (graph-only)
    deps = dedupe_preserve(deps + providers_for(MODULE_PROVIDERS, name))
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps,
        srcs = srcs,
        labels = kwargs.get("labels", []) or [],
        nix_inputs = nix_inputs,
    )


def nix_cpp_binary(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/cpp"])  # per-target local patch directories
    nix_cxx_attrs = kwargs.pop("nix_cxx_attrs", [])
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    # Explicit Nix-level inputs that should affect the rule key.
    nix_inputs = ["//:flake.lock", "//tools/nix/overlays:cpp-patches.nix"]
    stamp_labels(kwargs, "cpp", "bin")
    append_patch_srcs(kwargs, local_patch_dirs)
    srcs = kwargs.get("srcs", []) or []
    append_nixpkg_labels(kwargs, nix_cxx_attrs)
    # Realize provider edges for diagnostics/introspection (graph-only)
    deps = dedupe_preserve(deps + providers_for(MODULE_PROVIDERS, name))
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)),
        kind = "bin",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps,
        srcs = srcs,
        labels = kwargs.get("labels", []) or [],
        nix_inputs = nix_inputs,
    )


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    nix_cxx_attrs = kwargs.pop("nix_cxx_attrs", [])
    srcs = kwargs.get("srcs", [])
    planner_name = name + "__planner"
    # Planner-visible: stamps labels and wires providers so exporter->planner can generate the Nix derivation
    _planner_kwargs = dict(kwargs)
    stamp_labels(_planner_kwargs, "cpp", "test")
    # Add direct call-site attrs as nixpkg labels (shared helper)
    append_nixpkg_labels(_planner_kwargs, nix_cxx_attrs)
    _planner_labels = (_planner_kwargs.get("labels", []) or [])
    # Planner-visible stub: declare a cxx_library without compiling test sources; Nix will build the test.
    # Filter provider deps from planner to avoid visibility / graph-edge to providers
    _planner_deps = []
    for d in deps:
        if not isinstance(d, str):
            continue
        if d.startswith("//third_party/providers:"):
            continue
        _planner_deps.append(d)

    cpp_planner_stub(
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
    # Node-API addon producing a .node shared library
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/cpp"])
    nix_cxx_attrs = kwargs.pop("nix_cxx_attrs", [])
    deps = kwargs.pop("deps", [])
    # Optional addon_name hint; for now recorded in labels for planner visibility
    addon_name = kwargs.pop("addon_name", None)
    nix_inputs = ["//:flake.lock", "//tools/nix/overlays:cpp-patches.nix"]
    stamp_labels(kwargs, "cpp", "addon")
    if addon_name:
        _labels = (kwargs.get("labels", []) or [])
        # Encode addon name hint for the planner (non-functional label; reserved prefix)
        _labels = dedupe_preserve(_labels + ["addon_name:%s" % addon_name])
        kwargs["labels"] = _labels
    append_patch_srcs(kwargs, local_patch_dirs)
    srcs = kwargs.get("srcs", []) or []
    append_nixpkg_labels(kwargs, nix_cxx_attrs)
    deps = dedupe_preserve(deps + providers_for(MODULE_PROVIDERS, name))
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".node",
        kind = "addon",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps,
        srcs = srcs,
        labels = kwargs.get("labels", []) or [],
        nix_inputs = nix_inputs,
    )

__all__ = [
    "nix_cpp_library",
    "nix_cpp_binary",
    "nix_cpp_test",
    "nix_cpp_node_addon",
    "cpp_sanitize_probe",
]

