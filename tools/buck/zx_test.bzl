def _zx_test_impl(ctx):
    script = ctx.attrs.script
    # Export NODE_V8_COVERAGE so child Node processes also write coverage data, but only when COVERAGE=1.
    run_and_report = (
        (
            "if [ \"$COVERAGE\" = \"1\" ]; then export NODE_V8_COVERAGE=$(pwd)/coverage/raw; else unset NODE_V8_COVERAGE; fi; "
            + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
            + "export NODE_BIN=\"$(command -v node)\"; "
            + "export PATH=\"$(pwd)/tools/bin:$(pwd)/node_modules/.bin:$PATH\"; "
            # Load dev shell environment at repo root via direnv if needed (fast),
            # so tools like secretspec/copier are on PATH without per-temp flake eval
            + "if ! command -v secretspec >/dev/null 2>&1 || ! command -v copier >/dev/null 2>&1; then if command -v direnv >/dev/null 2>&1; then eval \"$(direnv export bash)\"; fi; fi; "
            # Skip direnv in temp repos by default; specific tests can override
            + "export JIO_SKIP_DIRENV=\"${JIO_SKIP_DIRENV:-1}\"; "
            + "unset IN_NIX_SHELL; "
            # Provide a sane default per-test timeout for debugging runs unless overridden
            + "if [ -z \"$TEST_NODE_OPTIONS\" ]; then export TEST_NODE_OPTIONS=\"--test-timeout=120000\"; fi; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; "
            + "ls -1t \"$NODE_V8_COVERAGE\"/coverage-*.json 2>/dev/null | tail -n +201 | xargs -r rm -f || true; fi; "
            # Keep NODE_OPTIONS untouched; pass test flags on CLI instead
            + "export NODE_OPTIONS=\"$NODE_OPTIONS\"; "
            + "\"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" %s; STATUS=$?; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "\"$NODE_BIN\" ./node_modules/c8/bin/c8.js report "
            + "--clean=false --temp-directory \"$NODE_V8_COVERAGE\" "
            + "--reports-dir coverage --reporter=json-summary --reporter=lcov --reporter=html "
            + "--extension .ts --allowExternal --all --src . || true; "
            + "\"$NODE_BIN\" ./tools/dev/coverage-normalize.mjs || true; "
            + "fi; exit \"$STATUS\""
        )
        % (script.short_path,)
    )
    cmd = [
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
