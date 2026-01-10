load("//lang:nix_shell.bzl", "nix_build_out_path_cmd", "nix_cmd_prefix")
load("//lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")

def _go_nix_build_wasm_impl(ctx):
    """
    Build a TinyGo wasm artifact via the Nix planner and copy the produced wasm.
    """
    raw = ctx.attrs.self_label
    expected_rel = ctx.attrs.expected_rel
    # Default to the graph-aware selected build path (build-selected.ts), which can consume
    # exported graph semantics (e.g. link_deps / link_closure). The minimal selected-wasm
    # path intentionally bypasses the exported graph and must be explicitly opted into.
    build_prefix = "env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" " + ("BUCK_TARGET=\"%s\" " % raw)
    # Use a per-target stable log path so tests can assert the build path deterministically
    # without racing on a single global /tmp file across concurrent builds.
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"/tmp/go_nix_build_wasm_build.${SAFE_LOG_KEY}.log\"; "
    )
    run_and_copy = (
        nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + safe_log_path_prefix
        + "if [ \"${USE_SELECTED_WASM:-0}\" = \"1\" ]; then "
        + nix_build_out_path_cmd(
            "\"path:$FLK_ROOT#graph-generator-selected-wasm\"",
            timeout_var = "TIMEOUT",
            impure = True,
            build_prefix = build_prefix,
        )
        + "else "
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
        + "fi; "
        + "test -n \"$outPath\"; "
        + (
            (
                "if [ ! -e \"$outPath/%s\" ]; then "
                + "  echo 'go_nix_build_wasm (%s): expected artifact not found: %s' >&2; "
                + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
                + "  if [ -d \"$outPath/lib\" ]; then ls -la \"$outPath/lib\" >&2; fi; "
                + "  exit 2; "
                + "fi; "
            ) % (expected_rel, raw, expected_rel)
        )
        + "DEST=\"$0\"; cp -f \"$outPath/%s\" \"$DEST\"; " % expected_rel
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args([
        "bash",
        "-c",
        "USE_SELECTED_WASM=%s; %s" % ("1" if ctx.attrs.use_selected_wasm else "0", run_and_copy),
        out.as_output(),
    ], hidden = ctx.attrs.srcs + ctx.attrs.nix_inputs)
    ctx.actions.run(cmd, category = "go_nix_build_wasm")
    return [DefaultInfo(default_output = out)]

go_nix_build_wasm = rule(
    impl = _go_nix_build_wasm_impl,
    attrs = {
        "self_label": attrs.string(),
        "out": attrs.string(),
        "expected_rel": attrs.string(default = "lib/top.wasm"),
        "deps": attrs.list(attrs.dep(), default = []),
        "link_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(attrs.label(), attrs.string(), default = {}),
        "use_selected_wasm": attrs.bool(default = False),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)


