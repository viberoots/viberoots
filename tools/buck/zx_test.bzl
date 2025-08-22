def _zx_test_impl(ctx):
    script = ctx.attrs.script
    cmd = [
        "node",
        "--experimental-strip-types",
        "--import",
        "./tools/dev/zx-init.mjs",
        "--test",
        script.short_path,
    ]
    # Declare a tiny output to satisfy Buck's expectation of outputs
    stamp = ctx.actions.declare_output(ctx.label.name + ".stamp")
    ctx.actions.write(stamp, "zx_test\n")
    return [
        DefaultInfo(default_output = stamp),
        ExternalRunnerTestInfo(
            type = "custom",
            command = cmd,
            env = {},
            labels = [],
            contacts = [],
        ),
    ]

zx_test = rule(
    impl = _zx_test_impl,
    attrs = {
        "script": attrs.source(),
    },
)
