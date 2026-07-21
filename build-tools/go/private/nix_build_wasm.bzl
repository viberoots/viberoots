load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_cmd_prefix")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")

def _go_nix_build_wasm_impl(ctx):
    """
    Build a TinyGo wasm artifact via the Nix planner and copy the produced wasm.
    """
    raw = ctx.attrs.self_label
    expected_rel = ctx.attrs.expected_rel
    # Default to the graph-aware selected build path (build-selected.ts), which can consume
    # exported graph semantics (e.g. link_deps / link_closure). The minimal selected-wasm
    # path intentionally bypasses the exported graph and must be explicitly opted into.
    # Use a per-target stable log path so tests can assert the build path deterministically
    # without racing on a single global /tmp file across concurrent builds.
    #
    # IMPORTANT: keep the log under WORKSPACE_ROOT so parallel Buck tests running in distinct
    # temp repos don't collide on shared /tmp paths.
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG_DIR=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected\"; "
        + "BUILD_SELECTED_LOG=\"$BUILD_SELECTED_LOG_DIR/go_nix_build_wasm_build.${SAFE_LOG_KEY}.log\"; "
        + "mkdir -p \"$BUILD_SELECTED_LOG_DIR\"; "
        + "GO_WASM_UNAME_FILE=\"$BUILD_SELECTED_LOG_DIR/uname.txt\"; "
        + "GO_WASM_UNAME=\"\"; "
        + "if uname -s > \"$GO_WASM_UNAME_FILE\" 2>/dev/null; then if read -r GO_WASM_UNAME < \"$GO_WASM_UNAME_FILE\" 2>/dev/null; then :; else GO_WASM_UNAME=\"\"; fi; else GO_WASM_UNAME=\"\"; fi; "
        + "if [ \"$GO_WASM_UNAME\" = \"Darwin\" ]; then [ ! -e \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\"; [ ! -e \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] && : > \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\"; fi; "
    )
    run_and_copy = (
        "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$PWD/$DEST\" ;; esac; "
        + nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + safe_log_path_prefix
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            attr = "graph-generator-selected-wasm" if ctx.attrs.use_selected_wasm else "graph-generator-selected",
            graph_json_arg = "$1",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; "
        + "  echo \"go_nix_build_wasm (%s): build-selected produced no output path\" >&2; " % raw
        + "  exit 2; "
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
        + "cp -f \"$outPath/%s\" \"$DEST\"; " % expected_rel
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    declared_inputs = nix_artifact_action_inputs(ctx)
    cmd = cmd_args([
        nix_artifact_bash(),
        "-c",
        run_and_copy,
        out.as_output(),
        ctx.attrs._graph_json,
        declared_inputs,
    ], hidden = declared_inputs)
    policy_info = run_nix_action(ctx, cmd, category = "go_nix_build_wasm", declared_inputs = declared_inputs)
    return [DefaultInfo(default_output = out)] + policy_info

go_nix_build_wasm = rule(
    impl = _go_nix_build_wasm_impl,
    attrs = with_nix_artifact_action_attrs({
        "self_label": attrs.string(),
        "out": attrs.string(),
        "expected_rel": attrs.string(default = "lib/top.wasm"),
        "deps": attrs.list(attrs.dep(), default = []),
        "link_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(attrs.label(), attrs.string(), default = {}),
        "nixpkgs_profile": attrs.string(default = "default"),
        "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
        "use_selected_wasm": attrs.bool(default = False),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    }),
)
