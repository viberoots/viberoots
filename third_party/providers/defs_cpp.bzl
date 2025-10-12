load("@prelude//:rules.bzl", "genrule")

def nix_cxx_provider(name, attr, overlay_paths = [], patch_paths = [], lockfile = "flake.lock"):
    """
    Content-addressed stamp for nixpkgs attribute providers.
    Inputs drive Buck invalidation; compilation happens in Nix templates.
    """
    srcs = []
    for p in overlay_paths or []:
        srcs.append(p)
    for p in patch_paths or []:
        srcs.append(p)
    if isinstance(lockfile, str) and lockfile != "":
        srcs.append(lockfile)
    genrule(
        name = name,
        srcs = srcs,
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        labels = ["lang:cpp", "nixpkg:%s" % attr],
        visibility = ["//visibility:public"],
    )

def nix_cxx_library(name, attr, headers_subdir = None, static = True, shared = False):
    """
    Back-compat alias to provider stamp (replaces old cxx_library shim).
    """
    nix_cxx_provider(name = name, attr = attr)

def nix_cxx_gtest_providers():
    # Convenience macro to declare gtest providers when needed locally
    nix_cxx_provider(name = "nix_pkgs_gtest", attr = "pkgs.googletest")
    nix_cxx_provider(name = "nix_pkgs_gtest_main", attr = "pkgs.googletest")


