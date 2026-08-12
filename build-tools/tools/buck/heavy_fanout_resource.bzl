load("@prelude//python:toolchain.bzl", "PythonToolchainInfo")

def _heavy_fanout_resource_impl(ctx):
    interpreter = ctx.attrs._python_toolchain[PythonToolchainInfo].interpreter
    return [
        DefaultInfo(),
        LocalResourceInfo(
            setup = cmd_args(interpreter, ctx.attrs.setup),
            resource_env_vars = {
                "VBR_HEAVY_FANOUT_PERMIT": "permit",
            },
        ),
    ]

heavy_fanout_resource = rule(
    impl = _heavy_fanout_resource_impl,
    attrs = {
        "setup": attrs.source(),
        "_python_toolchain": attrs.toolchain_dep(
            default = "toolchains//:python",
            providers = [PythonToolchainInfo],
        ),
    },
)
