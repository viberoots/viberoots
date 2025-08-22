def _zx_test_impl(ctx):
    script = ctx.attrs.script
    cmd = [
        "bash",
        "-lc",
        # Use node directly; zx-wrapper shebang on the script handles the flags
        "node {}".format(script.short_path),
    ]
    ctx.actions.run(
        cmd_args(cmd),
        category = "test",
        identifier = ctx.label.name,
        local_only = True,
    )
    return []

zx_test = rule(
    impl = _zx_test_impl,
    attrs = {
        "script": attrs.source(),
    },
)
