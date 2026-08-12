load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_calling_env_export_source_snapshot", "nix_calling_env_materialize_source_snapshot_for_execution", "nix_cmd_prefix", "nix_declared_action_inputs_manifest_cmd")

RustWasmArtifactInfo = provider(fields = ["runtime", "provenance"])

def register_rust_wasm_provenance_action(
        ctx,
        planner_label,
        source_snapshot,
        source_snapshot_manifest,
        snapshot_args,
        control_inputs,
        declared_inputs,
        action_timeout_sec,
        local_only):
    provenance = ctx.actions.declare_output(ctx.attrs.out + ".provenance", dir = True)
    command = (
        nix_cmd_prefix(
            timeout_var = "TIMEOUT",
            timeout_sec = action_timeout_sec,
            include_pnpm_store = False,
            escape_cmd_subst = True,
        )
        + nix_declared_action_inputs_manifest_cmd()
        + nix_calling_env_export_source_snapshot(
            snapshot_root = "${2:-}",
            manifest_path = "${3:-}",
        )
        + "if [ -n \"${2:-}\" ]; then \"$VBR_ARTIFACT_TOOLS_ROOT/bin/node\" --disable-warning=ExperimentalWarning --experimental-strip-types \"${8:-}\" \"${2:-}\" \"${3:-}\"; fi; "
        + nix_calling_env_materialize_source_snapshot_for_execution(
            snapshot_root = "${2:-}",
            flake_file = "${4:-}",
            flake_lock = "${5:-}",
            node_modules_hashes = "${6:-}",
            nixpkgs_registry_extension = "${7:-}",
        )
        + "PROVENANCE_LOG=\"$TMP/build-selected/rust_nix_build.provenance.log\"; mkdir -p \"$(dirname \"$PROVENANCE_LOG\")\"; "
        + nix_action_build_selected_out_path_cmd(
            target_label = planner_label,
            out_var = "provenancePath",
            raw_var = "PROVENANCE_RAW",
            status_var = "PROVENANCE_STATUS",
            log_file = "$PROVENANCE_LOG",
            graph_json_arg = "${BUCK_GRAPH_JSON:-$1}",
            derivation_output = "provenance",
        )
        + "if [ \"$PROVENANCE_STATUS\" -ne 0 ] || [ -z \"$provenancePath\" ]; then "
        + "  test ! -f \"$PROVENANCE_LOG\" || cat \"$PROVENANCE_LOG\" >&2; "
        + "  test \"$PROVENANCE_STATUS\" -eq 0 || exit \"$PROVENANCE_STATUS\"; "
        + "  echo \"rust_nix_build: provenance build produced no output path\" >&2; exit 2; "
        + "fi; "
        + "test -f \"$provenancePath/share/viberoots-rust/materialization-manifest.json\" || "
        + "  { echo \"rust_nix_build: provenance output is missing materialization evidence\" >&2; exit 2; }; "
        + "mkdir -p \"$0\"; cp -R \"$provenancePath/.\" \"$0/\"; chmod -R u+w \"$0\"; "
    )
    cmd = cmd_args(
        [nix_artifact_bash(), "-c", command, provenance.as_output(), ctx.attrs._graph_json]
        + snapshot_args
        + control_inputs
        + [declared_inputs],
        hidden = declared_inputs,
    )
    ctx.actions.run(
        cmd_args(cmd, hidden = declared_inputs),
        category = "rust_nix_build_provenance",
        local_only = local_only,
    )
    return provenance

__all__ = ["RustWasmArtifactInfo", "register_rust_wasm_provenance_action"]
