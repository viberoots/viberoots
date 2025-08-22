def _zx_test_impl(ctx):
    script = ctx.attrs.script
    # Run the TypeScript test using local tsx from node_modules
    cmd = [
        "bash",
        "-lc",
        "./node_modules/.bin/tsx {}".format(script.short_path),
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
    test = True,
)
