load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/lang:nix_shell.bzl", "nix_cmd_prefix")
load("//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")

def _python_nix_build_impl(ctx):
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    sanitized = sanitize_name(raw)
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/python_nix_build.${SAFE_LOG_KEY}.log\"; "
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
        + ("EXPECTED=\"%s\"; " % ("py-" + sanitized))
        + "BIN=\"$outPath/bin/$EXPECTED\"; "
        + "if [ ! -x \"$BIN\" ]; then "
        + "  echo \"python_nix_build (%s): expected binary not found: $BIN\" >&2; " % raw
        + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
        + "  if [ -d \"$outPath/bin\" ]; then ls -la \"$outPath/bin\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + "DEST=\"$0\"; cp -f \"$BIN\" \"$DEST\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args(
        ["bash", "-c", run_and_copy, out.as_output()],
        hidden = ctx.attrs.srcs + ctx.attrs.nix_inputs,
    )
    ctx.actions.run(cmd, category = "python_nix_build")
    return [DefaultInfo(default_output = out)]

def _python_nix_pyext_build_impl(ctx):
    raw = ctx.attrs.self_label
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/python_nix_pyext.${SAFE_LOG_KEY}.log\"; "
        + "mkdir -p \"$(dirname \"$BUILD_SELECTED_LOG\")\"; "
    )
    run_and_stamp = (
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
        + "if [ ! -d \"$outPath/site\" ]; then "
        + "  echo \"python_nix_pyext_build (%s): expected site dir not found: $outPath/site\" >&2; " % raw
        + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + "DEST=\"$0\"; echo python_nix_pyext_build > \"$DEST\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args(
        ["bash", "-c", run_and_stamp, out.as_output()],
        hidden = ctx.attrs.srcs + ctx.attrs.nix_inputs,
    )
    ctx.actions.run(cmd, category = "python_nix_pyext_build")
    return [DefaultInfo(default_output = out)]

python_nix_build = rule(
    impl = _python_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

python_nix_pyext_build = rule(
    impl = _python_nix_pyext_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "out": attrs.string(),
        "module": attrs.string(default = ""),
        "deps": attrs.list(attrs.dep(), default = []),
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        "cflags": attrs.list(attrs.string(), default = []),
        "ldflags": attrs.list(attrs.string(), default = []),
        "build_py_deps": attrs.list(attrs.string(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

__all__ = [
    "python_nix_build",
    "python_nix_pyext_build",
]
