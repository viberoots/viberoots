load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")
load("@prelude//:rules.bzl", "clone_rule")

def _zx_test_impl(ctx):
    script = ctx.attrs.script
    timeout_ms = ctx.attrs.test_rule_timeout_ms if ctx.attrs.test_rule_timeout_ms != None else 20 * 60 * 1000
    timeout_sec = timeout_ms // 1000 if timeout_ms > 0 else 1200
    # Export NODE_V8_COVERAGE so child Node processes also write coverage data, but only when COVERAGE=1.
    run_and_report = (
        (
            "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-${BUCK_TEST_SRC:-$(pwd)}}\"; "
            + "# Guard against accidental WORKSPACE_ROOT drift into a node_modules symlink path.\n"
            + "if [ \"$(basename \"$WORKSPACE_ROOT\")\" = \"node_modules\" ] && [ -f \"$WORKSPACE_ROOT/../flake.nix\" ]; then "
            + "  WORKSPACE_ROOT=\"$(cd \"$WORKSPACE_ROOT/..\" && pwd)\"; "
            + "fi; "
            # Tests run under verify inside the dev shell, but Buck actions do not propagate IN_NIX_SHELL.
            # Many build-tools/tools/bin wrappers will re-exec via direnv when IN_NIX_SHELL is unset, which breaks
            # in tests that set HOME to a temp dir (direnv treats the repo .envrc as "blocked").
            + "export IN_NIX_SHELL=\"${IN_NIX_SHELL:-1}\"; "
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            # Default to no relink side-effects; tests may opt in with NO_NODE_MODULES_LINK=0.
            + "export NO_NODE_MODULES_LINK=\"${NO_NODE_MODULES_LINK:-1}\"; "
            + "# Coverage: keep NODE_V8_COVERAGE scoped to the actual node --test process (not helper node scripts),\n"
            + "# otherwise we generate massive raw coverage churn and slow the suite down.\n"
            + "V8COV_DIR=\"\"; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "  V8COV_DIR=\"${NODE_V8_COVERAGE:-$WORKSPACE_ROOT/buck-out/tmp/node-v8-coverage}\"; "
            + "  mkdir -p \"$V8COV_DIR\"; "
            + "fi; "
            + "export BUCK_TEST_TARGET=\"%s\"; "
            + "export TEST_LOG_DIR=\"${TEST_LOG_DIR:-$(pwd)/buck-out/test-logs}\"; "
            + "if [ -z \"$NODE_BIN\" ]; then export NODE_BIN=\"$(command -v node)\"; fi; "
            + "export BUCK_EXPORTER_REUSE_DAEMON=\"${BUCK_EXPORTER_REUSE_DAEMON:-1}\"; "
            + "if [ -z \"$BUCK_NESTED_ISO\" ]; then "
            + "  ISO_HASH=\"$($NODE_BIN -e 'const crypto=require(\"node:crypto\"); const path=require(\"node:path\"); const root=path.resolve(process.argv[1] || process.cwd()); process.stdout.write(crypto.createHash(\"sha256\").update(root).digest(\"hex\").slice(0, 10));' \"$WORKSPACE_ROOT\")\"; "
            + "  export BUCK_NESTED_ISO=\"zxtest-shared-$ISO_HASH\"; "
            + "fi; "
            # Ensure a valid TMPDIR inside the sandbox to avoid stale host TMPDIR paths
            + "export TMPDIR=\"${TMPDIR:-$WORKSPACE_ROOT/buck-out/tmp}\"; mkdir -p \"$TMPDIR\"; "
            + ""
            
            # Ensure Buck prelude/config present in test sandbox
            + "if [ ! -e .buckconfig ] || ! grep -q '^prelude = prelude' .buckconfig 2>/dev/null; then "
            + "  PRELUDE_PATH=\"\"; "
            + "  if [ -n \"${BNX_SHARED_PRELUDE_PATH:-}\" ] && [ -e \"$BNX_SHARED_PRELUDE_PATH\" ]; then PRELUDE_PATH=\"$BNX_SHARED_PRELUDE_PATH\"; fi; "
            + "  if [ -d \"$WORKSPACE_ROOT/prelude\" ] || [ -L \"$WORKSPACE_ROOT/prelude\" ]; then PRELUDE_PATH=\"$WORKSPACE_ROOT/prelude\"; fi; "
            + "  if [ -z \"$PRELUDE_PATH\" ]; then PRE_OUT=$(nix build \"$WORKSPACE_ROOT\"#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null | tail -1); fi; "
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
            + "  NM_OUT=\"${ZX_TEST_NODE_MODULES_OUT:-}\"; "
            + "  if [ -z \"$NM_OUT\" ]; then "
            + "    NM_OUT=$(bash --noprofile --norc -c 'cd \"$WORKSPACE_ROOT\" && NODE_BIN=\"$(command -v node)\" \"$NODE_BIN\" --experimental-strip-types --import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" \"$WORKSPACE_ROOT/build-tools/tools/dev/node-modules-build.ts\" --print-out-paths | tail -1'); "
            + "  fi; "
            + "  if [ -n \"$NM_OUT\" ] && [ -d \"$NM_OUT/node_modules\" ]; then "
            + "    DESIRED=\"$NM_OUT/node_modules\"; CUR=\"$WORKSPACE_ROOT/node_modules\"; CUR_TGT=; if [ -L \"$CUR\" ]; then CUR_TGT=\"$(readlink \"$CUR\")\"; fi; "
            + "    if [ \"$CUR_TGT\" != \"$DESIRED\" ]; then rm -rf \"$CUR\"; ln -s \"$DESIRED\" \"$CUR\"; fi; "
            + "  fi; "
            + "fi; "
            # Optional: allow tests to opt-in to direnv export when needed
            + "if [ \"$ZX_TEST_DIRENV\" = \"1\" ]; then if command -v direnv >/dev/null 2>&1; then eval \"$(direnv export bash)\"; fi; fi; "
            # Skip direnv in temp repos by default; specific tests can override
            # Provide a single global default timeout unless a caller overrides it
            + ("TSECS=%d; " % timeout_sec)
            + "for RAW_TSECS in \"${VERIFY_TIMEOUT_SECS:-}\" \"${TEST_NIX_TIMEOUT_SECS:-}\"; do "
            + "  if [ -n \"$RAW_TSECS\" ] && [ \"$RAW_TSECS\" -gt \"$TSECS\" ] 2>/dev/null; then TSECS=\"$RAW_TSECS\"; fi; "
            + "done; "
            + "if [ \"$TSECS\" -le 0 ] 2>/dev/null; then TSECS=1200; fi; "
            + "export TEST_NIX_TIMEOUT_SECS=\"$TSECS\"; "
            + "export NIX_PNPM_FETCH_TIMEOUT=\"$TSECS\"; "
            + "export NIX_PNPM_INSTALL_TIMEOUT=\"$TSECS\"; "
            + "export BNX_STREAM_NIX_BUILD_LOGS=\"${BNX_STREAM_NIX_BUILD_LOGS:-1}\"; "
            + "if [ -z \"$TEST_NODE_OPTIONS\" ]; then export TEST_NODE_OPTIONS=\"--test-timeout=$(( TSECS * 1000 ))\"; fi; "
            + "echo \"[zx_test] timeout target=$BUCK_TEST_TARGET tsecs=$TSECS node_options=${TEST_NODE_OPTIONS:-}\" >&2; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; fi; "
            # Ensure zx-init is loaded in all node:test workers via NODE_OPTIONS
            + "if [ -n \"$NODE_PATH\" ]; then export NODE_PATH=\"$WORKSPACE_ROOT/node_modules:$NODE_PATH\"; else export NODE_PATH=\"$WORKSPACE_ROOT/node_modules\"; fi; "
            + "export NODE_OPTIONS=\"--import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" $NODE_OPTIONS\"; "
            + "SAFE=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's|^.*/:||; s/[^A-Za-z0-9._-]+/_/g' | cut -c1-200); "
            + "LOGDIR=\"$TEST_LOG_DIR/$SAFE\"; mkdir -p \"$LOGDIR\"; "
            # Ensure any nested 'buck2' invocations in test scripts resolve to the original binary
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            + ""
            + "SHIMROOT=\"$WORKSPACE_ROOT/buck-out/zx_shims/$SAFE\"; SHIMBIN=\"$SHIMROOT/bin\"; mkdir -p \"$SHIMBIN\"; WRAP=\"$SHIMBIN/buck2\"; "
            + "cat > \"$WRAP\" <<'EOSH'\n"
            + "#!/usr/bin/env bash\n"
            + "set -euo pipefail\n"
            + "orig=\"__BUCK2_BIN__\"\n"
            + "if [[ -z \"${orig}\" ]]; then echo \"buck2 shim error: embedded buck2 path missing\" >&2; exit 127; fi\n"
            + "# Pass through to buck2; platform selection comes from .buckconfig in temp repos (//:no_cgo)\n"
            + "exec \"$orig\" \"$@\"\n"
            + "EOSH\n"
            + "sed -i.bak -e \"s|__BUCK2_BIN__|$ORIG_BUCK2|g\" \"$WRAP\"; rm -f \"$WRAP.bak\"; "
            + "chmod +x \"$WRAP\"; export PATH=\"$SHIMBIN:$PATH\"; "
            + "# Reuse shared buckd across tests to avoid fork storms; no per-test kill\n"
            + "rm -f \"$LOGDIR/test.stdout.log\" \"$LOGDIR/test.stderr.log\" 2>/dev/null || true; "
            + "cd \"$WORKSPACE_ROOT\"; "
            # Prefer package from Starlark context; fall back to parsing label, stripping any config suffix
            + "PKG=\"%s\"; "
            + "if [ -z \"$PKG\" ]; then PKG=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's/ \\([^)]*\\)$//; s#^.*//([^:]+):.*$#\\1#'); fi; "
            + "CAND1=\"$WORKSPACE_ROOT/%s\"; CAND2=\"$WORKSPACE_ROOT/$PKG/%s\"; "
            + "SCRIPT_PATH=\"$CAND1\"; if [ ! -f \"$SCRIPT_PATH\" ]; then SCRIPT_PATH=\"$CAND2\"; fi; "
            + "HEARTBEAT_RUNNER=\"$WORKSPACE_ROOT/build-tools/tools/dev/command-heartbeat.ts\"; "
            # TEMP: disable watchdog to avoid pre-test sleep impacting timeout
            + "WD=; "
            + "{ "
            + "  if [ \"$COVERAGE\" = \"1\" ] && [ -n \"$V8COV_DIR\" ]; then "
            + "    NODE_V8_COVERAGE=\"$V8COV_DIR\" \"$NODE_BIN\" --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" \"$HEARTBEAT_RUNNER\" --prefix \"[zx_test]\" --label \"target=$BUCK_TEST_TARGET step=node-test\" --cwd \"$WORKSPACE_ROOT\" --timeout-ms $(( TSECS * 1000 )) --no-output-warn-sec 60 -- \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" \"$SCRIPT_PATH\"; "
            + "  else "
            + "    \"$NODE_BIN\" --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" \"$HEARTBEAT_RUNNER\" --prefix \"[zx_test]\" --label \"target=$BUCK_TEST_TARGET step=node-test\" --cwd \"$WORKSPACE_ROOT\" --timeout-ms $(( TSECS * 1000 )) --no-output-warn-sec 60 -- \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$WORKSPACE_ROOT/build-tools/tools/dev/zx-init.mjs\" \"$SCRIPT_PATH\"; "
            + "  fi; "
            + "} > >(tee -a \"$LOGDIR/test.stdout.log\") 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*buckd\\.(stderr|stdout).*: task [0-9]+ was cancelled' | tee -a \"$LOGDIR/test.stderr.log\" >&2); STATUS=$?; "
            + "if [ -n \"$WD\" ]; then kill \"$WD\" >/dev/null 2>&1 || true; fi; "
            + "# Coverage reporting is done once per verify run (merged), not per zx_test.\n"
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
    labels = ctx.attrs.labels or []
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    stamp_cmd = cmd_args(
        ["bash", "-c", "echo zx_test > \"$1\"", "stamp", stamp.as_output()],
        hidden = [ctx.attrs.script] + (ctx.attrs.template_inputs or []),
    )
    ctx.actions.run(stamp_cmd, category = "zx_test_stamp")
    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
            type = "custom",
            command = cmd,
            labels = labels,
            contacts = [],
        )) + [
        DefaultInfo(
            default_output = stamp,
        ),
    ]

zx_test = clone_rule(
    "sh_test",
    extra_attrs = {
        "script": attrs.source(),
        # Ensure a default output so Buck always recognizes an output artifact
        "out": attrs.string(default = "zx_test.stamp"),
        "template_inputs": attrs.list(attrs.source(), default = []),
    },
    impl_override = _zx_test_impl,
)
