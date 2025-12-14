load("//lang:nix_shell.bzl", "nix_bootstrap_env_core")

def _go_nix_build_wasm_impl(ctx):
    """
    Build a TinyGo wasm artifact via the Nix planner and copy the produced wasm.
    """
    raw = ctx.attrs.self_label
    expected_rel = ctx.attrs.expected_rel
    # Prefer the specialized selected-wasm attribute for Go/TinyGo which does not
    # require the target to be present in the exported graph. Fallback to generic selected.
    run_and_copy = (
        nix_bootstrap_env_core()
        + ("OUT_PATH=$(BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" nix build --impure --print-out-paths --accept-flake-config \"path:$FLK_ROOT#graph-generator-selected-wasm\" || " % (raw))
        + ("BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" nix run --accept-flake-config \"path:$FLK_ROOT#zx-wrapper\" -- \"$FLK_ROOT/tools/dev/build-selected.ts\"); " % (raw))
        + "test -n \"$OUT_PATH\"; "
        + (
            "if [ ! -e \"$OUT_PATH/%s\" ]; then echo 'go_nix_build_wasm (%s): expected artifact not found: %s' >&2; (ls -la \"$OUT_PATH\"; ls -la \"$OUT_PATH/lib\" 2>/dev/null || true) >&2; exit 2; fi; "
            % (expected_rel, raw, expected_rel)
        )
        + "DEST=\"$0\"; cp -f \"$OUT_PATH/%s\" \"$DEST\"; " % expected_rel
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


