load("@prelude//:build_mode.bzl", "BuildModeInfo")
load("@prelude//decls:re_test_common.bzl", "re_test_common")
load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")
load("@prelude//tests:re_utils.bzl", "get_re_executors_from_props")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_bootstrap_env_core", "nix_timeout_wrapper_var")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "external_runner_command", "stamp_remote_readiness_labels", "write_nix_test_stamp")

def _remote_test_attrs():
    test_attrs = re_test_common.test_args()
    test_attrs["remote_execution_action_key_providers"] = attrs.dep(
        providers = [BuildModeInfo],
        default = "repo_toolchains//:remote_profile_conversion_action_key",
    )
    return test_attrs

def _rust_nix_test_impl(ctx):
    raw = ctx.attrs.self_label
    declared_inputs = nix_artifact_action_inputs(ctx) + [ctx.attrs.cargo_manifest, ctx.attrs.cargo_lock]
    safe_log = (
        "SAFE_LOG_KEY=\"%s\"; " % raw +
        "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; " +
        "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/rust_nix_test.${SAFE_LOG_KEY}.log\"; " +
        "mkdir -p \"$(dirname \"$BUILD_SELECTED_LOG\")\"; "
    )
    run_test = (
        "GRAPH_ARG=\"${1:-}\"; WORKSPACE_ROOT_ENV_ARG=\"${2:-}\"; " +
        "if [ -f \"$WORKSPACE_ROOT_ENV_ARG\" ]; then . \"$WORKSPACE_ROOT_ENV_ARG\"; fi; " +
        nix_bootstrap_env_core() +
        safe_log +
        nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "OUT_PATH",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            graph_json_arg = "$GRAPH_ARG",
        ) +
        "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then " +
        "  test ! -f \"$BUILD_SELECTED_LOG\" || cat \"$BUILD_SELECTED_LOG\" >&2; " +
        "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; " +
        "  echo 'rust_nix_test: build-selected produced no output path' >&2; exit 2; " +
        "fi; TEST_BIN=\"$OUT_PATH/bin/%s\"; " % ctx.label.name +
        "if [ ! -x \"$TEST_BIN\" ]; then echo 'rust_nix_test: expected test runner is absent' >&2; exit 2; fi; " +
        "shift %s; " % (2 + len(declared_inputs)) +
        nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600) +
        "$TIMEOUT \"$TEST_BIN\" \"$@\""
    )
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    policy_info = write_nix_test_stamp(ctx, stamp, "rust_nix_test\n")
    re_executor, executor_overrides = get_re_executors_from_props(ctx)
    labels = stamp_remote_readiness_labels(ctx.attrs.labels)
    command = external_runner_command(
        labels,
        [nix_artifact_bash(), "-c", run_test, "rust_nix_test", ctx.attrs._graph_json, ctx.attrs._workspace_root_env] + declared_inputs,
        declared_inputs = declared_inputs,
        required_inputs = [ctx.attrs._build_selected, ctx.attrs._graph_json, ctx.attrs._workspace_root_env, ctx.attrs._zx_init],
    )
    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
        type = "rust",
        command = command,
        labels = labels,
        contacts = [],
        default_executor = re_executor,
        executor_overrides = executor_overrides,
        run_from_project_root = True,
        use_project_relative_paths = True,
    )) + [DefaultInfo(default_output = stamp)] + policy_info

_ATTRS = with_nix_artifact_action_attrs({
    "self_label": attrs.string(),
    "kind": attrs.string(),
    "out": attrs.string(),
    "deps": attrs.list(attrs.dep(), default = []),
    "srcs": attrs.list(attrs.source(), default = []),
    "nix_inputs": attrs.list(attrs.source(), default = []),
    "cargo_manifest": attrs.source(),
    "cargo_lock": attrs.source(),
    "crate": attrs.string(),
    "features": attrs.list(attrs.string(), default = []),
    "default_features": attrs.bool(default = True),
    "profile": attrs.string(default = "release"),
    "target": attrs.string(default = ""),
    "local_patch_dirs": attrs.list(attrs.string(), default = []),
    "nixpkgs_profile": attrs.string(default = "default"),
    "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
    "labels": attrs.list(attrs.string(), default = []),
    "test_rule_timeout_ms": attrs.option(attrs.int(), default = None),
    "_inject_test_env": attrs.default_only(attrs.dep(default = "prelude//test/tools:inject_test_env")),
})
_ATTRS.update(_remote_test_attrs())

rust_nix_test = rule(impl = _rust_nix_test_impl, attrs = _ATTRS)

__all__ = ["rust_nix_test"]
