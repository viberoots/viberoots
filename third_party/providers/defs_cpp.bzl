load("@prelude//:rules.bzl", "filegroup")

def nix_cxx_provider(name, attr):
    """
    Provider node that exposes a precomputed stamp file under this package:
      third_party/providers/stamps/<name>.stamp
    C++ provider sync is a no-op in this repo; these stamps are treated as
    precomputed/curated provider inputs rather than being regenerated locally.
    """
    filegroup(
        name = name,
        srcs = glob(["stamps/%s.stamp" % name]),
        labels = ["lang:cpp", "nixpkg:%s" % attr],
        visibility = ["//visibility:public"],
    )

def nix_cxx_library(name, attr, headers_subdir = None, static = True, shared = False):
    """
    Back-compat alias to provider stamp (replaces old cxx_library shim).
    """
    nix_cxx_provider(name = name, attr = attr)

def nix_cxx_gtest_providers():
    # Convenience macro to declare googletest provider when needed locally
    nix_cxx_provider(name = "nix_pkgs_googletest", attr = "pkgs.googletest")


