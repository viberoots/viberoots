def go_module_patch(name, module_key, patch_path):
    genrule(
        name = name,
        srcs = [patch_path],
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )


