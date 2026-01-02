load("//lang:nix_shell.bzl", "nix_build_out_path_cmd", "nix_cmd_prefix")
load("//lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")

def _go_nix_build_wasm_impl(ctx):
    """
    Build a TinyGo wasm artifact via the Nix planner and copy the produced wasm.
    """
    raw = ctx.attrs.self_label
    expected_rel = ctx.attrs.expected_rel
    # Prefer the specialized selected-wasm attribute for Go/TinyGo which does not
    # require the target to be present in the exported graph. Fallback to generic selected.
    build_prefix = "env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" " + ("BUCK_TARGET=\"%s\" " % raw)
    run_and_copy = (
        nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + "if "
        + nix_build_out_path_cmd(
            "\"path:$FLK_ROOT#graph-generator-selected-wasm\"",
            timeout_var = "TIMEOUT",
            impure = True,
            build_prefix = build_prefix,
        )
        + "then :; else "
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "/tmp/go_nix_build_wasm_build.log",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then cat /tmp/go_nix_build_wasm_build.log >&2 || true; exit ${NIX_STATUS:-2}; fi; "
        + "fi; "
        + "test -n \"$outPath\"; "
        + (
            "if [ ! -e \"$outPath/%s\" ]; then echo 'go_nix_build_wasm (%s): expected artifact not found: %s' >&2; (ls -la \"$outPath\"; ls -la \"$outPath/lib\" 2>/dev/null || true) >&2; exit 2; fi; "
            % (expected_rel, raw, expected_rel)
        )
        + "DEST=\"$0\"; cp -f \"$outPath/%s\" \"$DEST\"; " % expected_rel
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args([
        "bash",
        "-c",
        run_and_copy,
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
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)


