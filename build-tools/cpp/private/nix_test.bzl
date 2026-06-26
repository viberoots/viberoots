load("@viberoots//build-tools/lang:sanitize.bzl", "sanitize_name")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_bootstrap_env_core", "nix_calling_env_export_source_snapshot", "nix_timeout_wrapper_var")
load("@viberoots//build-tools/lang:nix_attr.bzl", "sanitize_nix_attr_from_target_label")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "external_runner_command", "run_nix_action", "stamp_remote_readiness_labels")
load("@prelude//:build_mode.bzl", "BuildModeInfo")
load("@prelude//decls:re_test_common.bzl", "re_test_common")
load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")
load("@prelude//tests:re_utils.bzl", "get_re_executors_from_props")

def _remote_test_attrs():
    test_attrs = re_test_common.test_args()
    test_attrs["remote_execution_action_key_providers"] = attrs.dep(
        providers = [BuildModeInfo],
        default = "repo_toolchains//:remote_profile_conversion_action_key",
    )
    return test_attrs

def _cpp_nix_test_impl(ctx):
    pkg = ctx.label.package
    nm = ctx.label.name
    # Build per-target attr exposed by flake: packages.<system>.graph-generator-cppTargets.<sanitized>
    # Sanitize label to match cppTargetsFlat in graph-generator.nix
    raw = ctx.attrs.planner_label
    # Compute expected test binary name deterministically based on the planner label
    expected_bin = sanitize_name(raw)
    attr = sanitize_nix_attr_from_target_label(raw)
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/cpp_nix_test.${SAFE_LOG_KEY}.log\"; "
        + "BUILD_SELECTED_LOG_DIR=\"$(dirname \"$BUILD_SELECTED_LOG\")\"; mkdir -p \"$BUILD_SELECTED_LOG_DIR\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\"; [ ! -e \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] && : > \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\"; fi; "
    )
    run_and_exec = (
        "WORKSPACE_ROOT_ENV_ARG=\"${1:-}\"; "
        + "if [ -n \"$WORKSPACE_ROOT_ENV_ARG\" ] && [ -f \"$WORKSPACE_ROOT_ENV_ARG\" ]; then . \"$WORKSPACE_ROOT_ENV_ARG\" 2>/dev/null || true; fi; "
        + nix_calling_env_export_source_snapshot(snapshot_root = "${2:-}", manifest_path = "${3:-}")
        + nix_bootstrap_env_core()
        + safe_log_path_prefix
        + ("echo '[cpp_nix_test] planner_label=%s' >&2; " % raw)
        + ("echo '[cpp_nix_test] target_attr=%s' >&2; " % attr)
        + ("export BUCK_TARGET_ATTR='%s'; " % attr)
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "OUT_PATH",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        + "echo \"[cpp_nix_test] OUT_PATH=$OUT_PATH\" >&2; "
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then "
        + "  echo '[cpp_nix_test] build-selected failed' >&2; "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; "
        + "  echo '[cpp_nix_test] build-selected produced no output path' >&2; "
        + "  exit 2; "
        + "fi; "
        + ("BIN='%s'; " % expected_bin)
        + "CAND=\"$OUT_PATH/bin/$BIN\"; "
        + "if [ ! -x \"$CAND\" ]; then "
        + "  echo '[cpp_nix_test] expected bin not found:' \"$CAND\" >&2; "
        + "  base=\"%s\"; base=${base##*:}; " % raw
        + "  found=$(ls -1 \"$OUT_PATH/bin\" 2>/dev/null | grep -E \"(^|-)${base}$\" | head -n1 || true); "
        + "  if [ -n \"$found\" ] && [ -x \"$OUT_PATH/bin/$found\" ]; then CAND=\"$OUT_PATH/bin/$found\"; else ls -la \"$OUT_PATH\" >&2 || true; ls -la \"$OUT_PATH/bin\" >&2 || true; exit 2; fi; "
        + "fi; "
        + nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600)
        + "$TIMEOUT \"$CAND\""
    )
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    stamp_cmd = cmd_args(
        ["bash", "-c", "echo cpp_nix_test > \"$1\"", "stamp", stamp.as_output()],
        hidden = ctx.attrs.nix_inputs,
    )
    policy_info = run_nix_action(ctx, stamp_cmd, category = "cpp_nix_test_stamp")
    re_executor, executor_overrides = get_re_executors_from_props(ctx)
    snapshot_inputs = []
    if ctx.attrs.source_snapshot != None:
        snapshot_inputs.append(ctx.attrs.source_snapshot)
    if ctx.attrs.source_snapshot_manifest != None:
        snapshot_inputs.append(ctx.attrs.source_snapshot_manifest)
    snapshot_labels = []
    if ctx.attrs.source_snapshot != None and ctx.attrs.source_snapshot_manifest != None:
        snapshot_labels = ["source-snapshot:declared-root", "source-snapshot:manifest", "source-snapshot:graph"]
    labels = stamp_remote_readiness_labels(ctx.attrs.labels + snapshot_labels)
    remote_command = [ctx.attrs.remote_ready_runner] + snapshot_inputs if ctx.attrs.remote_ready_runner != None else None
    declared_inputs = ctx.attrs.nix_inputs + snapshot_inputs + ([] if ctx.attrs.remote_ready_runner == None else [ctx.attrs.remote_ready_runner]) + [
        ctx.attrs._build_selected,
        ctx.attrs._graph_json,
        ctx.attrs._workspace_root_env,
        ctx.attrs._zx_init,
    ]
    command = external_runner_command(
        labels,
        ["bash", "-c", run_and_exec, "cpp_nix_test", ctx.attrs._workspace_root_env] + snapshot_inputs,
        remote_command = remote_command,
        declared_inputs = declared_inputs,
        required_inputs = [
            ctx.attrs.remote_ready_runner,
            ctx.attrs._build_selected,
            ctx.attrs._graph_json,
            ctx.attrs._workspace_root_env,
            ctx.attrs._zx_init,
        ] + snapshot_inputs,
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
        DefaultInfo(default_output = stamp),
    ] + policy_info


_CPP_NIX_TEST_ATTRS = {
        "planner_label": attrs.string(),
        "out": attrs.string(),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
        "source_snapshot": attrs.option(attrs.source(), default = None),
        "source_snapshot_manifest": attrs.option(attrs.source(), default = None),
        "remote_ready_runner": attrs.option(attrs.source(), default = None),
        "test_rule_timeout_ms": attrs.option(attrs.int(), default = None),
        "_inject_test_env": attrs.default_only(attrs.dep(default = "prelude//test/tools:inject_test_env")),
        "_build_selected": attrs.source(default = "@viberoots//build-tools/tools/dev:build-selected.ts"),
        "_graph_json": attrs.source(default = "workspace_buck//:graph.json"),
        "_workspace_root_env": attrs.source(default = "workspace_buck//:workspace-root.env"),
        "_zx_init": attrs.source(default = "@viberoots//build-tools/tools/dev:zx-init.mjs"),
        # Create a graph edge so exporter cquery includes the planner cxx_test node
        "planner": attrs.dep(),
    }
_CPP_NIX_TEST_ATTRS.update(_remote_test_attrs())

cpp_nix_test = rule(
    impl = _cpp_nix_test_impl,
    attrs = _CPP_NIX_TEST_ATTRS,
)
