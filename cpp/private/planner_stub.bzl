def _cpp_planner_stub_impl(ctx):
    # Minimal planner-visible node: writes a stamp file and exposes edges via deps
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, "planner\n")
    return [DefaultInfo(default_output = out)]


cpp_planner_stub = rule(
    impl = _cpp_planner_stub_impl,
    attrs = {
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)


