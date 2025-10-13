def _replace_all(hay, needle, repl):
    if needle == "":
        return hay
    return repl.join(hay.split(needle))


def sanitize_to_bin_name(s):
    # Mirror tools/nix/templates-common.nix sanitizeName exactly:
    # replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s
    s1 = _replace_all(s, "//", "")
    s2 = _replace_all(s1, ":", "-")
    s3 = _replace_all(s2, "/", "-")
    s4 = _replace_all(s3, " ", "-")
    return s4


def _sanitize_probe_impl(ctx):
    # Emit a tiny file containing the sanitized form of the provided label
    val = sanitize_to_bin_name(ctx.attrs.label)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, val + "\n")
    return [DefaultInfo(default_output = out)]


_sanitize_probe = rule(
    impl = _sanitize_probe_impl,
    attrs = {
        "label": attrs.string(),
        "out": attrs.string(),
    },
)


def cpp_sanitize_probe(name, label):
    # Helper used only in tests to surface the sanitizer result via a declared output name
    _sanitize_probe(
        name = name,
        label = label,
        out = sanitize_to_bin_name(label) + ".txt",
    )


