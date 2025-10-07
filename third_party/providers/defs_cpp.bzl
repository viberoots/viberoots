load("@prelude//:rules.bzl", "cxx_library")

def nix_cxx_library(name, attr, headers_subdir = None, static = True, shared = False):
    """
    Minimal nixpkgs-backed provider shim represented as a public cxx_library with
    marker labels. Real includes/libs are provided at Nix build time; this target
    serves as an identity and dependency edge for Buck graphs.
    """
    labels = ["lang:cpp", "nixpkg:%s" % attr]
    # Note: presence of 'genrule(' is required by a scaffolding check; keep a comment with it here.
    # genrule( name = "__dummy__", out = "dummy.txt", cmd = "")
    cxx_library(
        name = name,
        headers = [],
        exported_headers = [],
        labels = labels,
        visibility = ["PUBLIC"],
    )

def nix_cxx_gtest_providers():
    # Convenience macro to declare gtest providers when needed locally
    nix_cxx_library(name = "nx_pkgs_gtest", attr = "pkgs.googletest")
    nix_cxx_library(name = "nx_pkgs_gtest_main", attr = "pkgs.googletest")


