load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")
load("@prelude//:build_mode.bzl", "BuildModeInfo")
load("@prelude//:rules.bzl", "clone_rule")
load("@prelude//decls:re_test_common.bzl", "re_test_common")
load("@prelude//tests:re_utils.bzl", "get_re_executors_from_props")
load("@viberoots//build-tools/lang:nix_cache_health.bzl", "nix_cache_health_shell")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_calling_env_export_source_snapshot")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "external_runner_command", "remote_ready_evidence", "run_nix_action", "stamp_remote_readiness_labels")
load("@viberoots//build-tools/lang:source_snapshot.bzl", "SourceSnapshotInfo")
def _zx_test_impl(ctx):
    script = ctx.attrs.script
    timeout_ms = ctx.attrs.test_rule_timeout_ms if ctx.attrs.test_rule_timeout_ms != None else 20 * 60 * 1000
    timeout_sec = timeout_ms // 1000 if timeout_ms > 0 else 1200
    run_and_report = (
        (
            nix_calling_env_export_source_snapshot()
            + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-${BUCK_TEST_SRC:-$(pwd)}}\"; "
            + "if [ \"$(basename \"$WORKSPACE_ROOT\")\" = \"node_modules\" ] && [ -f \"$WORKSPACE_ROOT/../flake.nix\" ]; then "
            + "  WORKSPACE_ROOT=\"$(cd \"$WORKSPACE_ROOT/..\" && pwd)\"; "
            + "fi; "
            + "export IN_NIX_SHELL=\"${IN_NIX_SHELL:-1}\"; "
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            + "export NO_NODE_MODULES_LINK=\"${NO_NODE_MODULES_LINK:-1}\"; "
            + "V8COV_DIR=\"\"; "
            + "if [ \"$COVERAGE\" = \"1\" ]; then "
            + "  V8COV_DIR=\"${NODE_V8_COVERAGE:-$WORKSPACE_ROOT/buck-out/tmp/node-v8-coverage}\"; "
            + "  mkdir -p \"$V8COV_DIR\"; "
            + "fi; "
            + "export BUCK_TEST_TARGET=\"%s\"; "
            + "export TEST_LOG_DIR=\"${TEST_LOG_DIR:-$(pwd)/buck-out/test-logs}\"; "
            + "if [ -z \"$NODE_BIN\" ]; then export NODE_BIN=\"$(command -v node)\"; fi; "
            + "VBR_ROOT=\"${VIBEROOTS_ROOT:-}\"; "
            + "if [ -z \"$VBR_ROOT\" ] || [ ! -f \"$VBR_ROOT/build-tools/tools/dev/zx-init.mjs\" ]; then "
            + "  if [ -f \"$WORKSPACE_ROOT/.viberoots/current/build-tools/tools/dev/zx-init.mjs\" ]; then VBR_ROOT=\"$WORKSPACE_ROOT/.viberoots/current\"; else VBR_ROOT=\"$WORKSPACE_ROOT\"; fi; "
            + "fi; "
            + "export VIBEROOTS_ROOT=\"$VBR_ROOT\"; "
            + "VBR_ZX_INIT=\"$VBR_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
            + "VBR_NODE_MODULES_BUILD=\"$VBR_ROOT/build-tools/tools/dev/node-modules-build.ts\"; "
            + "VBR_HEARTBEAT_RUNNER=\"$VBR_ROOT/build-tools/tools/dev/command-heartbeat.ts\"; "
            + "export VBR_ZX_INIT VBR_NODE_MODULES_BUILD VBR_HEARTBEAT_RUNNER; "
            + "if [ -d \"$VBR_ROOT/build-tools/tools/bin\" ]; then export PATH=\"$VBR_ROOT/build-tools/tools/bin:$PATH\"; fi; "
            + "export BUCK_EXPORTER_REUSE_DAEMON=\"${BUCK_EXPORTER_REUSE_DAEMON:-1}\"; "
            + "if [ -z \"$BUCK_NESTED_ISO\" ]; then "
            + "  ISO_HASH=\"$($NODE_BIN -e 'const crypto=require(\"node:crypto\"); const path=require(\"node:path\"); const root=path.resolve(process.argv[1] || process.cwd()); process.stdout.write(crypto.createHash(\"sha256\").update(root).digest(\"hex\").slice(0, 10));' \"$WORKSPACE_ROOT\")\"; "
            + "  export BUCK_NESTED_ISO=\"zxtest-shared-$ISO_HASH\"; "
            + "fi; "
            + "export TMPDIR=\"${TMPDIR:-$WORKSPACE_ROOT/buck-out/tmp}\"; mkdir -p \"$TMPDIR\"; "
            + nix_cache_health_shell().replace("%", "%%")
            + "if [ ! -e .buckconfig ] || ! grep -q '^prelude = prelude' .buckconfig 2>/dev/null; then "
            + "  PRELUDE_PATH=\"\"; "
            + "  if [ -n \"${VBR_SHARED_PRELUDE_PATH:-}\" ] && [ -e \"$VBR_SHARED_PRELUDE_PATH\" ]; then PRELUDE_PATH=\"$VBR_SHARED_PRELUDE_PATH\"; fi; "
            + "  if [ -d \"$WORKSPACE_ROOT/prelude\" ] || [ -L \"$WORKSPACE_ROOT/prelude\" ]; then PRELUDE_PATH=\"$WORKSPACE_ROOT/prelude\"; fi; "
            + "  if [ -z \"$PRELUDE_PATH\" ]; then PRE_OUT=$(nix build \"$WORKSPACE_ROOT\"#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null | tail -1); fi; "
            + "  if [ -z \"$PRELUDE_PATH\" ] && [ -n \"$PRE_OUT\" ]; then PRELUDE_PATH=\"$PRE_OUT/prelude\"; fi; "
            + "  printf '.\\n' > \"$WORKSPACE_ROOT/.buckroot\"; "
            + "  mkdir -p \"$WORKSPACE_ROOT/.viberoots\"; [ -e \"$WORKSPACE_ROOT/.viberoots/current\" ] || ln -s .. \"$WORKSPACE_ROOT/.viberoots/current\"; "
            + "  if [ -n \"$PRELUDE_PATH\" ] && [ ! -e \"$WORKSPACE_ROOT/prelude\" ]; then ln -s \"$PRELUDE_PATH\" \"$WORKSPACE_ROOT/prelude\"; fi; "
            + "  cat > \"$WORKSPACE_ROOT/.buckconfig\" <<'EOF'\n"
            + "[buildfile]\n"
            + "name = TARGETS\n\n"
            + "[repositories]\nroot = .\nviberoots = ./.viberoots/current\n"
            + "prelude = ./prelude\n"
            + "toolchains = ./toolchains\n"
            + "repo_toolchains = ./toolchains\n"
            + "fbsource = ./prelude/third-party/fbsource_stub\n"
            + "fbcode = ./prelude/third-party/fbcode_stub\n"
            + "config = ./prelude\n\n"
            + "[cells]\nroot = .\nviberoots = ./.viberoots/current\n"
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
            + "if [ \"$NO_NODE_MODULES_LINK\" != \"1\" ] || [ ! -d \"$WORKSPACE_ROOT/node_modules\" ]; then "
            + "  NM_OUT=\"${ZX_TEST_NODE_MODULES_OUT:-}\"; "
            + "  if [ -z \"$NM_OUT\" ]; then "
            + "    NM_OUT=$(bash --noprofile --norc -c 'cd \"$WORKSPACE_ROOT\" && NODE_BIN=\"$(command -v node)\" \"$NODE_BIN\" --experimental-strip-types --import \"$VBR_ZX_INIT\" \"$VBR_NODE_MODULES_BUILD\" --print-out-paths | tail -1'); "
            + "  fi; "
            + "  if [ -n \"$NM_OUT\" ] && [ -d \"$NM_OUT/node_modules\" ]; then "
            + "    DESIRED=\"$NM_OUT/node_modules\"; CUR=\"$WORKSPACE_ROOT/node_modules\"; CUR_TGT=; if [ -L \"$CUR\" ]; then CUR_TGT=\"$(readlink \"$CUR\")\"; fi; "
            + "    if [ \"$CUR_TGT\" != \"$DESIRED\" ]; then rm -rf \"$CUR\"; ln -s \"$DESIRED\" \"$CUR\"; fi; "
            + "  fi; "
            + "fi; "
            + "if [ \"$ZX_TEST_DIRENV\" = \"1\" ]; then if command -v direnv >/dev/null 2>&1; then eval \"$(direnv export bash)\"; fi; fi; "
            + ("TSECS=%d; " % timeout_sec)
            + "for RAW_TSECS in \"${VERIFY_TIMEOUT_SECS:-}\" \"${TEST_NIX_TIMEOUT_SECS:-}\"; do "
            + "  if [ -n \"$RAW_TSECS\" ] && [ \"$RAW_TSECS\" -gt \"$TSECS\" ] 2>/dev/null; then TSECS=\"$RAW_TSECS\"; fi; "
            + "done; "
            + "if [ \"$TSECS\" -le 0 ] 2>/dev/null; then TSECS=1200; fi; "
            + "export TEST_NIX_TIMEOUT_SECS=\"$TSECS\"; "
            + "export NIX_PNPM_FETCH_TIMEOUT=\"$TSECS\"; "
            + "export NIX_PNPM_INSTALL_TIMEOUT=\"$TSECS\"; "
            + "export VBR_STREAM_NIX_BUILD_LOGS=\"${VBR_STREAM_NIX_BUILD_LOGS:-1}\"; "
            + "if [ -z \"$TEST_NODE_OPTIONS\" ]; then export TEST_NODE_OPTIONS=\"--test-timeout=$(( TSECS * 1000 ))\"; fi; "
            + "echo \"[zx_test] timeout target=$BUCK_TEST_TARGET tsecs=$TSECS node_options=${TEST_NODE_OPTIONS:-}\" >&2; "
            + "if [ -n \"$NODE_V8_COVERAGE\" ]; then mkdir -p \"$NODE_V8_COVERAGE\"; fi; "
            + "if [ -n \"$NODE_PATH\" ]; then export NODE_PATH=\"$WORKSPACE_ROOT/node_modules:$NODE_PATH\"; else export NODE_PATH=\"$WORKSPACE_ROOT/node_modules\"; fi; "
            + "export NODE_OPTIONS=\"--import $VBR_ZX_INIT $NODE_OPTIONS\"; "
            + "SAFE=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's|^.*/:||; s/[^A-Za-z0-9._-]+/_/g' | cut -c1-200); "
            + "LOGDIR=\"$TEST_LOG_DIR/$SAFE\"; mkdir -p \"$LOGDIR\"; "
            + "ORIG_BUCK2=\"$(command -v buck2)\"; "
            + "SHIMROOT=\"$WORKSPACE_ROOT/buck-out/zx_shims/$SAFE\"; SHIMBIN=\"$SHIMROOT/bin\"; mkdir -p \"$SHIMBIN\"; WRAP=\"$SHIMBIN/buck2\"; "
            + "cat > \"$WRAP\" <<'EOSH'\n"
            + "#!/usr/bin/env bash\n"
            + "set -euo pipefail\n"
            + "orig=\"__BUCK2_BIN__\"\n"
            + "if [[ -z \"${orig}\" ]]; then echo \"buck2 shim error: embedded buck2 path missing\" >&2; exit 127; fi\n"
            + "exec env -u BUCK_TEST_TARGET -u VBR_VERIFY_LOG_FILE -u VBR_VERIFY_PROCESS_STATE_FILE -u VBR_BUCK_REAPER_STATE_FILE \"$orig\" \"$@\"\n"
            + "EOSH\n"
            + "sed -i.bak -e \"s|__BUCK2_BIN__|$ORIG_BUCK2|g\" \"$WRAP\"; rm -f \"$WRAP.bak\"; "
            + "chmod +x \"$WRAP\"; export PATH=\"$SHIMBIN:$PATH\"; "
            + "rm -f \"$LOGDIR/test.stdout.log\" \"$LOGDIR/test.stderr.log\" 2>/dev/null || true; "
            + "cd \"$WORKSPACE_ROOT\"; "
            + "PKG=\"%s\"; "
            + "if [ -z \"$PKG\" ]; then PKG=$(printf %%s \"$BUCK_TEST_TARGET\" | sed -E 's/ \\([^)]*\\)$//; s#^.*//([^:]+):.*$#\\1#'); fi; "
            + "CAND1=\"$WORKSPACE_ROOT/%s\"; CAND2=\"$WORKSPACE_ROOT/$PKG/%s\"; CAND3=\"$VBR_ROOT/%s\"; "
            + "SCRIPT_PATH=\"$CAND1\"; if [ ! -f \"$SCRIPT_PATH\" ]; then SCRIPT_PATH=\"$CAND2\"; fi; "
            + "if [ ! -f \"$SCRIPT_PATH\" ]; then SCRIPT_PATH=\"$CAND3\"; fi; "
            + "HEARTBEAT_RUNNER=\"$VBR_HEARTBEAT_RUNNER\"; "
            + "WD=; "
            + "{ "
            + "  if [ \"$COVERAGE\" = \"1\" ] && [ -n \"$V8COV_DIR\" ]; then "
            + "    NODE_V8_COVERAGE=\"$V8COV_DIR\" \"$NODE_BIN\" --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$VBR_ZX_INIT\" \"$HEARTBEAT_RUNNER\" --prefix \"[zx_test]\" --label \"target=$BUCK_TEST_TARGET step=node-test\" --cwd \"$WORKSPACE_ROOT\" --timeout-ms $(( TSECS * 1000 )) --no-output-warn-sec 60 -- \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$VBR_ZX_INIT\" \"$SCRIPT_PATH\"; "
            + "  else "
            + "    \"$NODE_BIN\" --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$VBR_ZX_INIT\" \"$HEARTBEAT_RUNNER\" --prefix \"[zx_test]\" --label \"target=$BUCK_TEST_TARGET step=node-test\" --cwd \"$WORKSPACE_ROOT\" --timeout-ms $(( TSECS * 1000 )) --no-output-warn-sec 60 -- \"$NODE_BIN\" $TEST_NODE_OPTIONS --test --experimental-strip-types --import \"$VBR_ZX_INIT\" \"$SCRIPT_PATH\"; "
            + "  fi; "
            + "} > >(tee -a \"$LOGDIR/test.stdout.log\") 2> >(grep -Ev 'buck2_client_ctx::file_tailers::tailer: Failed to read from .*buckd\\.(stderr|stdout).*: task [0-9]+ was cancelled' | tee -a \"$LOGDIR/test.stderr.log\" >&2); STATUS=$?; "
            + "if [ -n \"$WD\" ]; then kill \"$WD\" >/dev/null 2>&1 || true; fi; "
            + "exit \"$STATUS\""
        )
        % (ctx.label, ctx.label.package, script.short_path, script.short_path, script.short_path)
    )
    local_command = [
        "bash",
        "-c",
        run_and_report,
        "zx_test",
    ]
    labels = stamp_remote_readiness_labels(ctx.attrs.labels)
    if ctx.attrs.remote_execution == "":
        if "re_ignore_force_run_as_bundle" not in labels:
            labels.append("re_ignore_force_run_as_bundle")
        re_executor, executor_overrides = None, {}
    else:
        re_executor, executor_overrides = get_re_executors_from_props(ctx)
    source_snapshot = ctx.attrs.source_snapshot
    source_snapshot_manifest = ctx.attrs.source_snapshot_manifest
    if ctx.attrs.source_snapshot_bundle != None:
        if source_snapshot != None or source_snapshot_manifest != None:
            fail("source_snapshot_bundle cannot be combined with source_snapshot or source_snapshot_manifest")
        snapshot_info = ctx.attrs.source_snapshot_bundle[SourceSnapshotInfo]
        source_snapshot = snapshot_info.snapshot
        source_snapshot_manifest = snapshot_info.manifest
    snapshot_inputs = []
    if source_snapshot != None:
        snapshot_inputs.append(source_snapshot)
    if source_snapshot_manifest != None:
        snapshot_inputs.append(source_snapshot_manifest)
    snapshot_labels = []
    if source_snapshot != None and source_snapshot_manifest != None:
        snapshot_labels = ["source-snapshot:declared-root", "source-snapshot:manifest", "source-snapshot:graph"]
    labels = labels + snapshot_labels
    evidence_inputs = [
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ] if ctx.attrs.remote_ready_runner != None else []
    remote_command = [ctx.attrs.remote_ready_runner] + snapshot_inputs + evidence_inputs if ctx.attrs.remote_ready_runner != None else None
    declared_inputs = ([] if ctx.attrs.remote_ready_runner == None else [ctx.attrs.remote_ready_runner]) + [
        ctx.attrs.script,
        ctx.attrs._command_heartbeat,
        ctx.attrs._node_modules_build,
        ctx.attrs._zx_init,
    ] + snapshot_inputs + evidence_inputs + (ctx.attrs.template_inputs or [])
    command = external_runner_command(
        labels,
        local_command + snapshot_inputs,
        remote_command = remote_command,
        declared_inputs = declared_inputs,
        required_inputs = [
            ctx.attrs.remote_ready_runner,
            ctx.attrs.script,
            ctx.attrs._command_heartbeat,
            ctx.attrs._node_modules_build,
            ctx.attrs._zx_init,
        ] + snapshot_inputs + evidence_inputs,
    )
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    stamp_cmd = cmd_args(
        ["bash", "-c", "echo zx_test > \"$1\"", "stamp", stamp.as_output()],
        hidden = [ctx.attrs.script] + (ctx.attrs.template_inputs or []),
    )
    policy_mode = "remote-ready" if "remote:ready" in labels else "local-only"
    policy_evidence = remote_ready_evidence(
        source_snapshot,
        source_snapshot_manifest,
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ) if policy_mode == "remote-ready" else None
    policy_info = run_nix_action(
        ctx,
        stamp_cmd,
        category = "zx_test_stamp",
        mode = policy_mode,
        evidence = policy_evidence,
    )
    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
            type = "custom",
            command = command,
            labels = labels,
            contacts = [],
            default_executor = re_executor,
            executor_overrides = executor_overrides,
            run_from_project_root = True,
            use_project_relative_paths = True,
        )) + [
        DefaultInfo(
            default_output = stamp,
        ),
    ] + policy_info
zx_test = clone_rule(
    "sh_test",
    extra_attrs = {
        "script": attrs.source(),
        "out": attrs.string(default = "zx_test.stamp"),
        "remote_ready_runner": attrs.option(attrs.source(), default = None),
        "source_snapshot_bundle": attrs.option(attrs.dep(providers = [SourceSnapshotInfo]), default = None),
        "source_snapshot": attrs.option(attrs.source(), default = None),
        "source_snapshot_manifest": attrs.option(attrs.source(), default = None),
        "materialization_manifest": attrs.option(attrs.source(), default = None),
        "artifact_contract": attrs.option(attrs.source(), default = None),
        "tool_closure": attrs.option(attrs.source(), default = None),
        "remote_builder_smoke": attrs.option(attrs.source(), default = None),
        "template_inputs": attrs.list(attrs.source(), default = []),
        "remote_execution": attrs.one_of(
            attrs.string(),
            re_test_common.opts_for_tests_arg(),
            default = read_config("test", "viberoots_remote_profile", ""),
        ),
        "remote_execution_action_key_providers": attrs.dep(
            providers = [BuildModeInfo],
            default = "repo_toolchains//:remote_profile_conversion_action_key",
        ),
        "_command_heartbeat": attrs.source(default = "@viberoots//build-tools/tools/dev:command-heartbeat.ts"),
        "_node_modules_build": attrs.source(default = "@viberoots//build-tools/tools/dev:node-modules-build.ts"),
        "_zx_init": attrs.source(default = "@viberoots//build-tools/tools/dev:zx-init.mjs"),
    },
    impl_override = _zx_test_impl,
)
