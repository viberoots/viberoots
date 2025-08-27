def _zx_test_impl(ctx):
    script = ctx.attrs.script
    # Export NODE_V8_COVERAGE so child Node processes also write coverage data, but only when COVERAGE=1.
    run_and_report = (
        (
            "if [ \"$COVERAGE\" = \"1\" ]; then export NODE_V8_COVERAGE=$(pwd)/coverage/raw; else unset NODE_V8_COVERAGE; fi; "
            + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
            + "export NODE_BIN=\"$(command -v node)\"; "
            + "export PATH=\"$(pwd)/tools/bin:$(pwd)/node_modules/.bin:$PATH\"; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; "
            + "ls -1t \"$NODE_V8_COVERAGE\"/coverage-*.json 2>/dev/null | tail -n +201 | xargs -r rm -f || true; fi; "
            # Allow passing extra Node flags to tests via TEST_NODE_OPTIONS
            + "export NODE_OPTIONS=\"$TEST_NODE_OPTIONS $NODE_OPTIONS\"; "
            # Start timing (escape % for Starlark formatting)
            + "_t_start=$(date +%%s%%3N); "
            + "\"$NODE_BIN\" --test --experimental-strip-types --import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" %s; STATUS=$?; "
            + "_t_end=$(date +%%s%%3N); _dur_ms=$(( _t_end - _t_start )); echo \"[timing] target %s: ${_dur_ms}ms\"; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "\"$NODE_BIN\" ./node_modules/c8/bin/c8.js report "
            + "--clean=false --temp-directory \"$NODE_V8_COVERAGE\" "
            + "--reports-dir coverage --reporter=json-summary --reporter=lcov --reporter=html "
            + "--extension .ts --allowExternal --all --src . || true; "
            + "\"$NODE_BIN\" ./tools/dev/coverage-normalize.mjs || true; "
            + "fi; exit \"$STATUS\""
        )
        % (script.short_path, ctx.attrs.out)
    )
    cmd = [
        "nix",
        "develop",
        "-c",
        "bash",
        "-c",
        run_and_report,
    ]
    # Declare a tiny output to satisfy Buck's expectation of outputs
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(stamp, "zx_test\n")
    return [
        DefaultInfo(
            default_output = stamp,
        ),
        ExternalRunnerTestInfo(
            type = "custom",
            command = cmd,
            labels = [],
            contacts = [],
        ),
    ]

zx_test = rule(
    impl = _zx_test_impl,
    attrs = {
        "script": attrs.source(),
        "out": attrs.string(),
    },
)
