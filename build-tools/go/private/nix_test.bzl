load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/lang:nix_shell.bzl", "nix_bootstrap_env_core", "nix_timeout_wrapper_var")
load("//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
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

def _go_nix_test_impl(ctx):
    raw = ctx.attrs.self_label
    expected_bin = sanitize_name(raw)
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/go_nix_test.${SAFE_LOG_KEY}.log\"; "
        + "mkdir -p \"$(dirname \"$BUILD_SELECTED_LOG\")\"; "
    )
    run_and_exec = (
        nix_bootstrap_env_core()
        + safe_log_path_prefix
        + ("echo '[go_nix_test] planner_label=%s' >&2; " % raw)
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "OUT_PATH",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  exit ${NIX_STATUS:-2}; "
        + "fi; "
        + ("BIN=\"$OUT_PATH/bin/%s\"; " % expected_bin)
        + "if [ ! -x \"$BIN\" ]; then "
        + "  echo '[go_nix_test] expected bin not found:' \"$BIN\" >&2; "
        + "  if [ -d \"$OUT_PATH\" ]; then ls -la \"$OUT_PATH\" >&2; fi; "
        + "  if [ -d \"$OUT_PATH/bin\" ]; then ls -la \"$OUT_PATH/bin\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 1800)
        + "$TIMEOUT \"$BIN\""
    )
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    stamp_cmd = cmd_args(
        ["bash", "-c", "echo go_nix_test > \"$1\"", "stamp", stamp.as_output()],
        hidden = ctx.attrs.nix_inputs,
    )
    ctx.actions.run(stamp_cmd, category = "go_nix_test_stamp")
    re_executor, executor_overrides = get_re_executors_from_props(ctx)
    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
            type = "custom",
            command = ["bash", "-c", run_and_exec],
            labels = ctx.attrs.labels,
            contacts = [],
            default_executor = re_executor,
            executor_overrides = executor_overrides,
            run_from_project_root = True,
            use_project_relative_paths = True,
        )) + [
        DefaultInfo(default_output = stamp),
    ]

_GO_NIX_TEST_ATTRS = {
        "self_label": attrs.string(),
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "library": attrs.option(attrs.dep(), default = None),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
        "test_rule_timeout_ms": attrs.option(attrs.int(), default = None),
        "_inject_test_env": attrs.default_only(attrs.dep(default = "prelude//test/tools:inject_test_env")),
        "override_cgo_enabled": attrs.bool(default = False),
        "asan": attrs.bool(default = False),
        "race": attrs.bool(default = False),
        "cgo_enabled": attrs.option(attrs.bool(), default = None),
    }
_GO_NIX_TEST_ATTRS.update(_remote_test_attrs())

go_nix_test = rule(
    impl = _go_nix_test_impl,
    attrs = _GO_NIX_TEST_ATTRS,
)
