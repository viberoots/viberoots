def _zx_test_impl(ctx):
    script = ctx.attrs.script
    out = ctx.actions.declare_output(ctx.label.name + ".stamp")
    cmd = [
        "bash",
        "-lc",
        "zx-wrapper node --test {} && echo ok > {}".format(script.short_path, out.as_output()),
    ]
    ctx.actions.run(
        cmd_args(cmd),
        category = "test",
        identifier = ctx.label.name,
        local_only = True,
    )
    return [DefaultInfo(default_output = out)]

zx_test = rule(
    impl = _zx_test_impl,
    attrs = {
        "script": attrs.source(),
    },
)
