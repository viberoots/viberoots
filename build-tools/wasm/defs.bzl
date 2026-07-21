load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_cmd_prefix")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")

def _shell_quote(value):
    return "'" + str(value).replace("'", "'\"'\"'") + "'"

def _nix_wasm_artifact_export_impl(ctx):
    target = ctx.attrs.target_label
    artifact_dir = ctx.attrs.artifact_dir
    artifact_name = ctx.attrs.artifact_name
    artifact_glob = ctx.attrs.artifact_glob
    run_and_copy = (
        "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$PWD/$DEST\" ;; esac; "
        + nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + nix_action_build_selected_out_path_cmd(
            target_label = target,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$TMP/wasm-artifact-export.log",
            graph_json_arg = "$1",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then "
        + "  if [ -f \"$TMP/wasm-artifact-export.log\" ]; then cat \"$TMP/wasm-artifact-export.log\" >&2; fi; "
        + "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; "
        + "  echo 'nix_wasm_artifact_export: selected build produced no output path' >&2; exit 2; "
        + "fi; "
        + ("SEARCH_ROOT=\"$outPath/%s\"; " % artifact_dir)
        + "if [ ! -d \"$SEARCH_ROOT\" ]; then echo \"nix_wasm_artifact_export: artifact directory not found: $SEARCH_ROOT\" >&2; exit 2; fi; "
        + "MATCHES=\"$TMP/wasm-artifact-export.matches\"; "
        + (
            ("CANDIDATE=\"$SEARCH_ROOT/%s\"; if [ -f \"$CANDIDATE\" ]; then printf '%%s\\n' \"$CANDIDATE\" > \"$MATCHES\"; else : > \"$MATCHES\"; fi; " % artifact_name)
            if artifact_name
            else ("find \"$SEARCH_ROOT\" -type f -name %s -print | sort > \"$MATCHES\"; " % _shell_quote(artifact_glob))
        )
        + "MATCH_COUNT_FILE=\"$TMP/wasm-artifact-export.count\"; awk 'END { print NR }' \"$MATCHES\" > \"$MATCH_COUNT_FILE\"; "
        + "MATCH_COUNT=\"\"; read -r MATCH_COUNT < \"$MATCH_COUNT_FILE\"; "
        + "if [ \"$MATCH_COUNT\" -ne 1 ]; then echo \"nix_wasm_artifact_export: expected exactly one artifact under $SEARCH_ROOT, found $MATCH_COUNT\" >&2; cat \"$MATCHES\" >&2; exit 2; fi; "
        + "ARTIFACT=\"\"; read -r ARTIFACT < \"$MATCHES\"; cp -f \"$ARTIFACT\" \"$DEST\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    declared_inputs = nix_artifact_action_inputs(ctx)
    cmd = cmd_args(
        [nix_artifact_bash(), "-c", run_and_copy, out.as_output(), ctx.attrs._graph_json, declared_inputs],
        hidden = declared_inputs,
    )
    policy_info = run_nix_action(
        ctx,
        cmd,
        category = "nix_wasm_artifact_export",
        declared_inputs = declared_inputs,
    )
    return [DefaultInfo(default_output = out)] + policy_info

_nix_wasm_artifact_export = rule(
    impl = _nix_wasm_artifact_export_impl,
    attrs = with_nix_artifact_action_attrs({
        "target_label": attrs.string(),
        "artifact_dir": attrs.string(),
        "artifact_name": attrs.string(default = ""),
        "artifact_glob": attrs.string(default = ""),
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    }),
)

def nix_wasm_artifact_export(
        name,
        target,
        artifact_dir,
        out,
        artifact_name = "",
        artifact_glob = "",
        labels = [],
        visibility = []):
    if not target:
        fail("nix_wasm_artifact_export: target is required")
    if not target.startswith("//"):
        fail("nix_wasm_artifact_export: target must be an absolute label")
    if not artifact_dir:
        fail("nix_wasm_artifact_export: artifact_dir is required")
    if bool(artifact_name) == bool(artifact_glob):
        fail("nix_wasm_artifact_export: set exactly one of artifact_name or artifact_glob")
    _nix_wasm_artifact_export(
        name = name,
        target_label = target,
        artifact_dir = artifact_dir,
        artifact_name = artifact_name,
        artifact_glob = artifact_glob,
        out = out,
        deps = [target],
        labels = list(labels) + ["planner_target:%s" % target],
        visibility = visibility,
    )
