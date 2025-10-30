def _zx_test_impl(ctx):
    script = ctx.attrs.script
    # Export NODE_V8_COVERAGE so child Node processes also write coverage data, but only when COVERAGE=1.
    run_and_report = (
        (
            "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-${BUCK_TEST_SRC:-$(pwd)}}\"; "
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            + "if [ \"$ZX_TEST_KILL_DAEMON\" = \"1\" ]; then \"$ORIG_BUCK2\" kill >/dev/null 2>&1 || true; fi; "
            # Default to linking workspace node_modules; tests may disable with NO_NODE_MODULES_LINK=1
            + "export NO_NODE_MODULES_LINK=\"${NO_NODE_MODULES_LINK:-0}\"; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then export NODE_V8_COVERAGE=\"$WORKSPACE_ROOT/coverage/raw\"; else unset NODE_V8_COVERAGE; fi; "
            + "export BUCK_TEST_TARGET=\"%s\"; "
            + "export TEST_LOG_DIR=\"${TEST_LOG_DIR:-$(pwd)/buck-out/test-logs}\"; "
            + "if [ -z \"$NODE_BIN\" ]; then export NODE_BIN=\"$(command -v node)\"; fi; "
            # Ensure a valid TMPDIR inside the sandbox to avoid stale host TMPDIR paths
            + "export TMPDIR=\"${TMPDIR:-$WORKSPACE_ROOT/buck-out/tmp}\"; mkdir -p \"$TMPDIR\"; "
            + ""
            
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
            + "            fi; "
            # Ensure node_modules available in sandbox by linking from flake output. Even when linking is disabled,
            # if node_modules is missing, provision a link to avoid ESM resolution failures for dev deps.
            + "if [ \"$NO_NODE_MODULES_LINK\" != \"1\" ] || [ ! -d \"$WORKSPACE_ROOT/node_modules\" ]; then "
            + "  NM_OUT=$(bash --noprofile --norc -c 'cd \"$WORKSPACE_ROOT\" && NODE_BIN=\"$(command -v node)\" \"$NODE_BIN\" --experimental-strip-types --import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" \"$WORKSPACE_ROOT/tools/dev/node-modules-build.ts\" --print-out-paths 2>/dev/null | tail -1'); "
            + "  if [ -n \"$NM_OUT\" ] && [ -d \"$NM_OUT/node_modules\" ]; then "
            + "    DESIRED=\"$NM_OUT/node_modules\"; CUR=\"$WORKSPACE_ROOT/node_modules\"; CUR_TGT=; if [ -L \"$CUR\" ]; then CUR_TGT=\"$(readlink \"$CUR\")\"; fi; "
            + "    if [ \"$CUR_TGT\" != \"$DESIRED\" ]; then rm -rf \"$CUR\"; ln -s \"$DESIRED\" \"$CUR\"; fi; "
            + "  fi; "
            + "fi; "
            # Optional: allow tests to opt-in to direnv export when needed
            + "if [ \"$ZX_TEST_DIRENV\" = \"1\" ]; then if command -v direnv >/dev/null 2>&1; then eval \"$(direnv export bash)\"; fi; fi; "
            # Skip direnv in temp repos by default; specific tests can override
            # Provide a single global default timeout unless a caller overrides it
            + "if [ -z \"$TEST_NODE_OPTIONS\" ]; then export TEST_NODE_OPTIONS=\"--test-timeout=240000\"; fi; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; "
            + "ls -1t \"$NODE_V8_COVERAGE\"/coverage-*.json 2>/dev/null | tail -n +201 | xargs -r rm -f || true; fi; "
            # Ensure zx-init is loaded in all node:test workers via NODE_OPTIONS
            + "if [ -n \"$NODE_PATH\" ]; then export NODE_PATH=\"$WORKSPACE_ROOT/node_modules:$NODE_PATH\"; else export NODE_PATH=\"$WORKSPACE_ROOT/node_modules\"; fi; "
            + "export NODE_OPTIONS=\"--import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" $NODE_OPTIONS\"; "
            + "SAFE=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's|^.*/:||; s/[^A-Za-z0-9._-]+/_/g' | cut -c1-200); "
            + "LOGDIR=\"$TEST_LOG_DIR/$SAFE\"; mkdir -p \"$LOGDIR\"; "
            # Use a deterministic buck2 isolation name per test to avoid accumulating daemons,
            # and kill the daemon at the end of the test regardless of status.
            + "export BUCK_ISOLATION_DIR=\"zxtest-$SAFE-$$\"; "
            # Nested isolation for any buck2 calls from inside the test to avoid lock contention with the outer test session
            + "export BUCK_NESTED_ISO=\"zxtest-nested-$SAFE-$$\"; "
            # If exporter spawns with its own isolation, nest it under the test isolation so cleanup is single-sourced
            + "export BUCK_ISOLATION_DIR_EXPORTER=\"$BUCK_ISOLATION_DIR\"; "
            # Ensure any nested 'buck2' invocations in test scripts use the same isolation dir
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            + ""
            + "SHIMROOT=\"$WORKSPACE_ROOT/buck-out/zx_shims/$SAFE\"; SHIMBIN=\"$SHIMROOT/bin\"; mkdir -p \"$SHIMBIN\"; WRAP=\"$SHIMBIN/buck2\"; "
            + "cat > \"$WRAP\" <<'EOSH'\n"
            + "#!/usr/bin/env bash\n"
            + "set -euo pipefail\n"
            + "orig=\"__BUCK2_BIN__\"\n"
            + "if [[ -z \"${orig}\" ]]; then echo \"buck2 shim error: embedded buck2 path missing\" >&2; exit 127; fi\n"
            + "# Avoid passing --isolation-dir twice if caller already set it\n"
            + "for a in \"$@\"; do if [ \"$a\" = \"--isolation-dir\" ]; then exec \"$orig\" \"$@\"; fi; done\n"
            + "iso=\"${BUCK_NESTED_ISO:-shim-$$}\"\n"
            + "cmd=\"$1\"; shift || true\n"
            + "# Normalize deprecated flags for newer buck2: --output-attributes -> repeated --output-attribute\n"
            + "norm=(); i=1; while [ $i -le $# ]; do a=\"$1\"; shift || true; i=$((i+1)); if [ \"$a\" = \"--output-attributes\" ]; then if [ $# -ge 1 ]; then v=\"$1\"; shift || true; i=$((i+1)); norm+=( --output-attribute \"$v\" ); else norm+=( --output-attribute ); fi; else norm+=( \"$a\" ); fi; done\n"
            + "# Detect if caller already specified --target-platforms or build.default_platform\n"
            + "has_tp=0; for a in \"${norm[@]}\"; do if [ \"$a\" = \"--target-platforms\" ]; then has_tp=1; break; fi; done\n"
            + "has_defplat=0; for a in \"${norm[@]}\"; do if echo \"$a\" | grep -q 'build.default_platform='; then has_defplat=1; break; fi; done\n"
            + "if [ \"$cmd\" = \"build\" ] || [ \"$cmd\" = \"test\" ]; then\n"
            + "  extra_flags=(); if [ $has_tp -eq 0 ] && [ $has_defplat -eq 0 ]; then extra_flags+=( --config build.default_platform=//:no_cgo --target-platforms //:no_cgo ); fi;\n"
            + "  exec \"$orig\" --isolation-dir \"$iso\" \"$cmd\" \"${extra_flags[@]}\" \"${norm[@]}\"\n"
            + "elif [ \"$cmd\" = \"run\" ] || [ \"$cmd\" = \"query\" ]; then\n"
            + "  exec \"$orig\" --isolation-dir \"$iso\" \"$cmd\" --config build.default_platform=//:no_cgo \"${norm[@]}\"\n"
            + "else\n"
            + "  exec \"$orig\" --isolation-dir \"$iso\" \"$cmd\" \"${norm[@]}\"\n"
            + "fi\n"
            + "EOSH\n"
            + "sed -i.bak -e \"s|__BUCK2_BIN__|$ORIG_BUCK2|g\" \"$WRAP\"; rm -f \"$WRAP.bak\"; "
            + "chmod +x \"$WRAP\"; export PATH=\"$SHIMBIN:$PATH\"; "
            + "cleanup() { \"$ORIG_BUCK2\" --isolation-dir \"$BUCK_NESTED_ISO\" kill >/dev/null 2>&1 || true; }; trap cleanup EXIT INT TERM HUP; "
            + "rm -f \"$LOGDIR/test.stdout.log\" \"$LOGDIR/test.stderr.log\" 2>/dev/null || true; "
            + "cd \"$WORKSPACE_ROOT\"; "
            # Prefer package from Starlark context; fall back to parsing label, stripping any config suffix
            + "PKG=\"%s\"; "
            + "if [ -z \"$PKG\" ]; then PKG=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's/ \\([^)]*\\)$//; s#^.*//([^:]+):.*$#\\1#'); fi; "
            + "CAND1=\"$WORKSPACE_ROOT/%s\"; CAND2=\"$WORKSPACE_ROOT/$PKG/%s\"; "
            + "SCRIPT_PATH=\"$CAND1\"; if [ ! -f \"$SCRIPT_PATH\" ]; then SCRIPT_PATH=\"$CAND2\"; fi; "
            # TEMP: disable watchdog to avoid pre-test sleep impacting timeout
            + "WD=; "
            + "{ \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$WORKSPACE_ROOT/tools/dev/zx-init.mjs\" \"$SCRIPT_PATH\"; } > >(tee -a \"$LOGDIR/test.stdout.log\") 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*buckd\\.(stderr|stdout).*: task [0-9]+ was cancelled' | tee -a \"$LOGDIR/test.stderr.log\" >&2); STATUS=$?; "
            + "if [ -n \"$WD\" ]; then kill \"$WD\" >/dev/null 2>&1 || true; fi; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "\"$NODE_BIN\" \"$WORKSPACE_ROOT/tools/dev/coverage-raw-normalize.mjs\" || true; "
            + "if [ -x \"$WORKSPACE_ROOT/node_modules/c8/bin/c8.js\" ]; then "
            + "\"$NODE_BIN\" \"$WORKSPACE_ROOT/node_modules/c8/bin/c8.js\" report "
            + "--clean=false --temp-directory \"$WORKSPACE_ROOT/coverage/raw\" "
            + "--reports-dir \"$WORKSPACE_ROOT/coverage\" --reporter=json-summary --reporter=lcov --reporter=html "
            + "--extension .ts --allowExternal --src \"$WORKSPACE_ROOT\" "
            + "--include \"**/*.ts\" "
            + "--exclude \"node_modules/**\" --exclude \"buck-out/**\" --exclude \".clinic/**\" --exclude \"**/*.d.ts\"; "
            + "\"$NODE_BIN\" ./tools/dev/coverage-normalize.mjs || true; "
            + "else echo 'warning: c8 missing; skipping coverage aggregation' >&2; fi; "
            + "fi; "
            + "# Intentionally keep the outer buck2 isolation alive to reduce cross-test cold starts\n"
            + "exit \"$STATUS\""
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
        # Ensure a default output so Buck always recognizes an output artifact
        "out": attrs.string(default = "zx_test.stamp"),
    },
)