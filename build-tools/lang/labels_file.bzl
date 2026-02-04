def _labels_file_impl(ctx):
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, "\n".join(ctx.attrs.labels) + "\n")
    return [DefaultInfo(default_output = out)]

labels_file = rule(
    impl = _labels_file_impl,
    attrs = {
        "labels": attrs.list(attrs.string(), default = []),
        "out": attrs.string(),
    },
)

__all__ = [
    "labels_file",
]


