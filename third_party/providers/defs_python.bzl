def python_importer_deps(name, lockfile, importer, patch_paths = []):
    genrule(
        name = name,
        srcs = [lockfile] + patch_paths,
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )


