load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/lang:nix_shell.bzl", "nix_bootstrap_env_core", "nix_timeout_wrapper_var")
load("//build-tools/lang:nix_attr.bzl", "sanitize_nix_attr_from_target_label")
load("//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")


def _cpp_nix_test_impl(ctx):
    pkg = ctx.label.package
    nm = ctx.label.name
    # Build per-target attr exposed by flake: packages.<system>.graph-generator-cppTargets.<sanitized>
    # Sanitize label to match cppTargetsFlat in graph-generator.nix
    raw = ctx.attrs.planner_label
    # Compute expected test binary name deterministically based on the planner label
    expected_bin = sanitize_name(raw)
    attr = sanitize_nix_attr_from_target_label(raw)
    run_and_exec = (
        nix_bootstrap_env_core()
        + ("echo '[cpp_nix_test] planner_label=%s' >&2; " % raw)
        + ("echo '[cpp_nix_test] target_attr=%s' >&2; " % attr)
        + ("export BUCK_TARGET_ATTR='%s'; " % attr)
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "OUT_PATH",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "/tmp/cpp_nix_test_build.log",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        + "echo \"[cpp_nix_test] OUT_PATH=$OUT_PATH\" >&2; "
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then echo '[cpp_nix_test] build-selected failed' >&2; cat /tmp/cpp_nix_test_build.log >&2 || true; exit ${NIX_STATUS:-2}; fi; "
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
    ctx.actions.run(stamp_cmd, category = "cpp_nix_test_stamp")
    return [
        DefaultInfo(default_output = stamp),
        ExternalRunnerTestInfo(
            type = "custom",
            command = ["bash", "-c", run_and_exec],
            labels = [],
            contacts = [],
        ),
    ]


cpp_nix_test = rule(
    impl = _cpp_nix_test_impl,
    attrs = {
        "planner_label": attrs.string(),
        "out": attrs.string(),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        # Create a graph edge so exporter cquery includes the planner cxx_test node
        "planner": attrs.dep(),
    },
)


