load("//build-tools/lang:sanitize.bzl", "sanitize_name")


def _sanitize_probe_impl(ctx):
    # Emit a tiny file containing the sanitized form of the provided label
    val = sanitize_name(ctx.attrs.label)
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
        out = sanitize_name(label) + ".txt",
    )


