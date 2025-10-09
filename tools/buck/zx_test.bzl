def _zx_test_impl(ctx):
    script = ctx.attrs.script
    # Export NODE_V8_COVERAGE so child Node processes also write coverage data, but only when COVERAGE=1.
    run_and_report = (
        (
            "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then export NODE_V8_COVERAGE=\"$WORKSPACE_ROOT/coverage/raw\"; else unset NODE_V8_COVERAGE; fi; "
            + "export BUCK_TEST_TARGET=\"%s\"; "
            + "export TEST_LOG_DIR=\"${TEST_LOG_DIR:-$(pwd)/buck-out/test-logs}\"; "
            + "if [ -z \"$NODE_BIN\" ]; then export NODE_BIN=\"$(command -v node)\"; fi; "
            # Ensure a valid TMPDIR inside the sandbox to avoid stale host TMPDIR paths
            + "export TMPDIR=\"${TMPDIR:-$WORKSPACE_ROOT/buck-out/tmp}\"; mkdir -p \"$TMPDIR\"; "
            
            # Ensure Buck prelude/config present in test sandbox
            + "if [ ! -e .buckconfig ] || ! grep -q '^prelude = prelude' .buckconfig 2>/dev/null; then "
            + "  if [ -d \"$WORKSPACE_ROOT/prelude\" ] || [ -L \"$WORKSPACE_ROOT/prelude\" ]; then PRELUDE_PATH=\"$WORKSPACE_ROOT/prelude\"; fi; "
            + "  if [ -z \"$PRELUDE_PATH\" ]; then PRE_OUT=$(nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null | tail -1); fi; "
            + "  if [ -z \"$PRELUDE_PATH\" ] && [ -n \"$PRE_OUT\" ]; then PRELUDE_PATH=\"$PRE_OUT/prelude\"; fi; "
            + "  printf '.\\n' > \"$WORKSPACE_ROOT/.buckroot\"; "
            + "  if [ -n \"$PRELUDE_PATH\" ] && [ ! -e \"$WORKSPACE_ROOT/prelude\" ]; then ln -s \"$PRELUDE_PATH\" \"$WORKSPACE_ROOT/prelude\"; fi; "
            + "  cat > \"$WORKSPACE_ROOT/.buckconfig\" <<'EOF'\n"
            + "[buildfile]\n"
            + "name = TARGETS\n\n"
            + "[repositories]\n"
            + "root = .\n"
            + "prelude = ./prelude\n"
            + "toolchains = ./toolchains\n"
            + "repo_toolchains = ./toolchains\n"
            + "fbsource = ./prelude/third-party/fbsource_stub\n"
            + "fbcode = ./prelude/third-party/fbcode_stub\n"
            + "config = ./prelude\n\n"
            + "[cells]\n"
            + "root = .\n"
            + "prelude = ./prelude\n"
            + "toolchains = ./toolchains\n"
            + "repo_toolchains = ./toolchains\n"
            + "fbsource = ./prelude/third-party/fbsource_stub\n"
            + "fbcode = ./prelude/third-party/fbcode_stub\n"
            + "config = ./prelude\n\n"
            + "[build]\n"
            + "prelude = prelude\n"
            + "user_platform = prelude//platforms:default\n"
            + "target_platforms = prelude//platforms:default\n"
            + "EOF\n"
            + "  mkdir -p \"$WORKSPACE_ROOT/toolchains\" && printf '[buildfile]\nname = TARGETS\n' > \"$WORKSPACE_ROOT/toolchains/.buckconfig\"; "
            # Ensure node_modules available in sandbox by linking from flake output
            + "  if [ ! -e \"$WORKSPACE_ROOT/node_modules\" ]; then "
            + "    NM_OUT=$(nix build \"$WORKSPACE_ROOT\"#node-modules --no-link --accept-flake-config --print-out-paths 2>/dev/null | tail -1); "
            + "    if [ -n \"$NM_OUT\" ] && [ -d \"$NM_OUT/node_modules\" ]; then ln -s \"$NM_OUT/node_modules\" \"$WORKSPACE_ROOT/node_modules\"; fi; "
            + "  fi; "
            + "            fi; "
            # Load dev shell environment at repo root via direnv if needed (fast),
            # so tools like secretspec/copier are on PATH without per-temp flake eval
            + "if ! command -v secretspec >/dev/null 2>&1 || ! command -v copier >/dev/null 2>&1; then if command -v direnv >/dev/null 2>&1; then eval \"$(direnv export bash)\"; fi; fi; "
            # Skip direnv in temp repos by default; specific tests can override
            # Provide a sane default per-test timeout for debugging runs unless overridden
            + "if [ -z \"$TEST_NODE_OPTIONS\" ]; then export TEST_NODE_OPTIONS=\"--test-timeout=180000\"; fi; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; "
            + "ls -1t \"$NODE_V8_COVERAGE\"/coverage-*.json 2>/dev/null | tail -n +201 | xargs -r rm -f || true; fi; "
            # Keep NODE_OPTIONS untouched; pass test flags on CLI instead
            + "export NODE_OPTIONS=\"$NODE_OPTIONS\"; "
            + "SAFE=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's|^.*/:||; s/[^A-Za-z0-9._-]+/_/g' | cut -c1-200); "
            + "LOGDIR=\"$TEST_LOG_DIR/$SAFE\"; mkdir -p \"$LOGDIR\"; "
            + "rm -f \"$LOGDIR/test.stdout.log\" \"$LOGDIR/test.stderr.log\" 2>/dev/null || true; "
            + "cd \"$WORKSPACE_ROOT\"; "
            # Prefer package from Starlark context; fall back to parsing label, stripping any config suffix
            + "PKG=\"%s\"; "
            + "if [ -z \"$PKG\" ]; then PKG=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's/ \\([^)]*\\)$//; s#^.*//([^:]+):.*$#\\1#'); fi; "
            + "CAND1=\"$WORKSPACE_ROOT/%s\"; CAND2=\"$WORKSPACE_ROOT/$PKG/%s\"; "
            + "SCRIPT_PATH=\"$CAND1\"; if [ ! -f \"$SCRIPT_PATH\" ]; then SCRIPT_PATH=\"$CAND2\"; fi; "
            + "{ \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" \"$SCRIPT_PATH\"; } > >(tee -a \"$LOGDIR/test.stdout.log\") 2> >(tee -a \"$LOGDIR/test.stderr.log\" >&2); STATUS=$?; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "\"$NODE_BIN\" \"$WORKSPACE_ROOT/tools/dev/coverage-raw-normalize.mjs\" || true; "
            + "\"$NODE_BIN\" \"$WORKSPACE_ROOT/node_modules/c8/bin/c8.js\" report "
            + "--clean=false --temp-directory \"$WORKSPACE_ROOT/coverage/raw\" "
            + "--reports-dir \"$WORKSPACE_ROOT/coverage\" --reporter=json-summary --reporter=lcov --reporter=html "
            + "--extension .ts --allowExternal --src \"$WORKSPACE_ROOT\" "
            + "--include \"**/*.ts\" "
            + "--exclude \"node_modules/**\" --exclude \"buck-out/**\" --exclude \".clinic/**\" --exclude \"**/*.d.ts\" "
            + "|| true; "
            + "\"$NODE_BIN\" ./tools/dev/coverage-normalize.mjs || true; "
            + "fi; exit \"$STATUS\""
        )
        % (ctx.label, ctx.label.package, script.short_path, script.short_path)
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