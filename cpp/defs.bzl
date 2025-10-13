load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
load("//third_party/providers:nix_attr_map.bzl", "NIX_ATTR_MAP")
load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//cpp/private:planner_stub.bzl", "cpp_planner_stub")
load("//cpp/private:nix_test.bzl", "cpp_nix_test")
load("//cpp/private:nix_build.bzl", "cpp_nix_build")

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])


def nix_cpp_library(name, **kwargs):
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "lib")
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps + _providers_for(name),
        labels = kwargs.get("labels", []),
    )


def nix_cpp_binary(name, **kwargs):
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "bin")
    cpp_nix_build(
        name = name,
        out = sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)),
        kind = "bin",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps + _providers_for(name),
        labels = kwargs.get("labels", []),
    )


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    srcs = kwargs.get("srcs", [])
    planner_name = name + "__planner"
    # Planner-visible: stamps labels and wires providers so exporter->planner can generate the Nix derivation
    _planner_kwargs = dict(kwargs)
    stamp_labels(_planner_kwargs, "cpp", "test")
    # Use generated mapping from provider targets → canonical nixpkg: labels (PR 3 Option A)
    extra_nixpkg_labels = []
    for d in deps:
        if isinstance(d, str) and d.startswith("//third_party/providers:"):
            lbl = NIX_ATTR_MAP.get(d)
            if lbl != None and isinstance(lbl, str) and lbl != "":
                extra_nixpkg_labels.append(lbl)
    _planner_labels = _planner_kwargs.get("labels", []) + extra_nixpkg_labels
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

__all__ = [
    "nix_cpp_library",
    "nix_cpp_binary",
    "nix_cpp_test",
    "cpp_sanitize_probe",
]

