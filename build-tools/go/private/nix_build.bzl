load("@viberoots//build-tools/lang:sanitize.bzl", "sanitize_name")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_cmd_prefix")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")

def _go_nix_build_impl(ctx):
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    sanitized = sanitize_name(raw)
    target_name = ctx.label.name
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/go_nix_build.${SAFE_LOG_KEY}.log\"; "
        + "mkdir -p \"$(dirname \"$BUILD_SELECTED_LOG\")\"; "
    )
    run_and_copy = (
        nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + safe_log_path_prefix
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  exit ${NIX_STATUS:-2}; "
        + "fi; "
        + "if [ \"%s\" = \"lib\" ]; then : > \"$0\"; exit 0; fi; " % kind
        + ("TARGET_NAME=\"%s\"; " % target_name)
        + ("SANITIZED=\"%s\"; " % sanitized)
        + "CAND=\"\"; "
        + "for c in \"$outPath/bin/$TARGET_NAME\" \"$outPath/bin/$SANITIZED\" \"$outPath/bin/go-$SANITIZED\"; do "
        + "  if [ -x \"$c\" ]; then CAND=\"$c\"; break; fi; "
        + "done; "
        + "if [ -z \"$CAND\" ]; then "
        + "  echo \"go_nix_build (%s): expected binary not found\" >&2; " % raw
        + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
        + "  if [ -d \"$outPath/bin\" ]; then ls -la \"$outPath/bin\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + "DEST=\"$0\"; cp -f \"$CAND\" \"$DEST\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args(
        ["bash", "-c", run_and_copy, out.as_output()],
        hidden = ctx.attrs.srcs + ctx.attrs.nix_inputs,
    )
    policy_info = run_nix_action(ctx, cmd, category = "go_nix_build")
    return [DefaultInfo(default_output = out)] + policy_info

go_nix_build = rule(
    impl = _go_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
        "override_cgo_enabled": attrs.bool(default = False),
        "asan": attrs.bool(default = False),
        "race": attrs.bool(default = False),
        "cgo_enabled": attrs.option(attrs.bool(), default = None),
    },
)
