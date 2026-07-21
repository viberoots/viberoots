load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd", "nix_action_workspace_setup_from_args")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_cmd_prefix")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")

def _go_nix_build_carchive_impl(ctx):
    raw = ctx.attrs.self_label
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$WORKSPACE_ROOT/buck-out/tmp/build-selected/go_nix_build_carchive.${SAFE_LOG_KEY}.log\"; "
        + "BUILD_SELECTED_LOG_DIR=\"$(dirname \"$BUILD_SELECTED_LOG\")\"; mkdir -p \"$BUILD_SELECTED_LOG_DIR\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/buck-out/tmp/.metadata_never_index\"; [ ! -e \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] && : > \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\"; fi; "
    )
    run_and_copy = (
        "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$PWD/$DEST\" ;; esac; "
        + nix_action_workspace_setup_from_args()
        + nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + "VBR_GRAPH_REAL_FILE=\"$TMP/vbr-declared-graph.real\"; realpath \"$GRAPH\" > \"$VBR_GRAPH_REAL_FILE\"; "
        + "BUCK_GRAPH_JSON=\"\"; read -r BUCK_GRAPH_JSON < \"$VBR_GRAPH_REAL_FILE\"; export BUCK_GRAPH_JSON; "
        + safe_log_path_prefix
        + nix_action_build_selected_out_path_cmd(
            target_label = raw,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; "
        + "  echo \"go_nix_build_carchive (%s): build-selected produced no output path\" >&2; " % raw
        + "  exit 2; "
        + "fi; "
        + "if [ ! -d \"$outPath/lib\" ] || [ ! -d \"$outPath/include\" ]; then "
        + "  echo \"go_nix_build_carchive (%s): expected lib/ and include/ in Nix output\" >&2; " % raw
        + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + "if ! ls \"$outPath/lib\"/*.a >/dev/null 2>&1; then "
        + "  echo \"go_nix_build_carchive (%s): missing archive in $outPath/lib\" >&2; " % raw
        + "  ls -la \"$outPath/lib\" >&2; "
        + "  exit 2; "
        + "fi; "
        + "if ! ls \"$outPath/include\"/*.h >/dev/null 2>&1; then "
        + "  echo \"go_nix_build_carchive (%s): missing header in $outPath/include\" >&2; " % raw
        + "  ls -la \"$outPath/include\" >&2; "
        + "  exit 2; "
        + "fi; "
        + "rm -rf \"$DEST\"; mkdir -p \"$DEST\"; "
        + "cp -R \"$outPath/lib\" \"$DEST/\"; "
        + "cp -R \"$outPath/include\" \"$DEST/\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    declared_inputs = nix_artifact_action_inputs(ctx)
    cmd = cmd_args(
        [
            nix_artifact_bash(),
            "-c",
            run_and_copy,
            out.as_output(),
            ctx.attrs._graph_json,
            ctx.attrs._workspace_root_env,
            "",
        ],
        hidden = declared_inputs,
    )
    policy_info = run_nix_action(ctx, cmd, category = "go_nix_build_carchive", declared_inputs = declared_inputs)
    return [DefaultInfo(default_output = out)] + policy_info

go_nix_build_carchive = rule(
    impl = _go_nix_build_carchive_impl,
    attrs = with_nix_artifact_action_attrs({
        "self_label": attrs.string(),
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
        "nixpkgs_profile": attrs.string(default = "default"),
        "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
        "override_cgo_enabled": attrs.bool(default = False),
        "asan": attrs.bool(default = False),
        "race": attrs.bool(default = False),
        "cgo_enabled": attrs.option(attrs.bool(), default = None),
    }),
)
