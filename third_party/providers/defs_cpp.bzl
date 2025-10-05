def nix_cxx_library(name, attr, headers_subdir = None, static = True, shared = False):
    # Minimal content-addressed stamp rule for a nixpkgs C/C++ library provider.
    # Inputs that affect consumers: the attr path string and toggles for static/shared,
    # plus optional headers subdir hint. This mirrors the Go provider stamp approach.
    key = "%s|%s|%s|%s" % (attr, headers_subdir or "", "1" if static else "0", "1" if shared else "0")
    genrule(
        name = name,
        # Encode provider identity as the stamp input so Buck invalidates dependents on change
        cmd = "echo %s > $OUT" % key,
        out = name + ".stamp",
        visibility = ["//visibility:public"],
    )


