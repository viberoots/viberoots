load("@viberoots//build-tools/lang:sanitize.bzl", "sanitize_name")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_calling_env_export_source_snapshot", "nix_calling_env_materialize_source_snapshot_for_execution", "nix_cmd_prefix", "nix_declared_action_inputs_manifest_cmd")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "remote_ready_evidence", "run_nix_action")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")
load("@viberoots//build-tools/lang:native_link.bzl", "NativeLinkInfo", "native_runtime_outputs")
load("@viberoots//build-tools/lang:source_snapshot.bzl", "SourceSnapshotInfo")
load("@viberoots//build-tools/rust/private:crate_contract.bzl", "rust_crate_closure_inputs", "rust_crate_contract_attrs", "rust_crate_info")

def _rust_nix_build_impl(ctx):
    raw = ctx.attrs.self_label
    planner_label = ctx.attrs.planner_label or raw
    planner_target_name = planner_label.split(":")[-1]
    kind = ctx.attrs.kind
    crate_type = ctx.attrs.crate_type
    sanitized = sanitize_name(raw)
    target_name = ctx.label.name
    source_snapshot = ctx.attrs.source_snapshot
    source_snapshot_manifest = ctx.attrs.source_snapshot_manifest
    if ctx.attrs.source_snapshot_bundle != None:
        if source_snapshot != None or source_snapshot_manifest != None:
            fail("source_snapshot_bundle cannot be combined with source_snapshot or source_snapshot_manifest")
        snapshot_info = ctx.attrs.source_snapshot_bundle[SourceSnapshotInfo]
        source_snapshot = snapshot_info.snapshot
        source_snapshot_manifest = snapshot_info.manifest
    snapshot_inputs = [value for value in [source_snapshot, source_snapshot_manifest] if value != None]
    snapshot_args = [source_snapshot or "", source_snapshot_manifest or ""]
    control_inputs = [
        ctx.attrs._flake_file,
        ctx.attrs._flake_lock,
        ctx.attrs._node_modules_hashes,
        ctx.attrs._nixpkgs_registry_extension,
        ctx.attrs._source_snapshot_validator,
    ]
    safe_log_path_prefix = (
        "SAFE_LOG_KEY=\"%s\"; " % raw
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; "
        + "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; "
        + "BUILD_SELECTED_LOG=\"$TMP/build-selected/rust_nix_build.${SAFE_LOG_KEY}.log\"; "
        + "BUILD_SELECTED_LOG_DIR=\"$(dirname \"$BUILD_SELECTED_LOG\")\"; mkdir -p \"$BUILD_SELECTED_LOG_DIR\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] && : > \"$BUILD_SELECTED_LOG_DIR/.metadata_never_index\"; fi; "
    )
    run_and_copy = (
        nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + nix_declared_action_inputs_manifest_cmd()
        + nix_calling_env_export_source_snapshot(snapshot_root = "${2:-}", manifest_path = "${3:-}")
        + "if [ -n \"${2:-}\" ]; then \"$VBR_ARTIFACT_TOOLS_ROOT/bin/node\" --disable-warning=ExperimentalWarning --experimental-strip-types \"${8:-}\" \"${2:-}\" \"${3:-}\"; fi; "
        + nix_calling_env_materialize_source_snapshot_for_execution(
            snapshot_root = "${2:-}",
            flake_file = "${4:-}",
            flake_lock = "${5:-}",
            node_modules_hashes = "${6:-}",
            nixpkgs_registry_extension = "${7:-}",
        )
        + safe_log_path_prefix
        + nix_action_build_selected_out_path_cmd(
            target_label = planner_label,
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            graph_json_arg = "${BUCK_GRAPH_JSON:-$1}",
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then "
        + "  if [ -f \"$BUILD_SELECTED_LOG\" ]; then cat \"$BUILD_SELECTED_LOG\" >&2; fi; "
        + "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; "
        + "  echo \"rust_nix_build (%s): build-selected produced no output path\" >&2; " % raw
        + "  exit 2; "
        + "fi; "
        + "if [ \"%s\" = \"lib\" ]; then " % kind
        + ("  CRATE_TYPE=\"%s\"; PUBLIC_CRATE=\"%s\"; " % (crate_type, ctx.attrs.public_crate or ctx.attrs.crate))
        + "  case \"$CRATE_TYPE\" in "
        + "    rlib) LIB=\"$outPath/lib/lib$PUBLIC_CRATE.rlib\" ;; "
        + "    staticlib) LIB=\"$outPath/lib/lib$PUBLIC_CRATE.a\" ;; "
        + "    cdylib) LIB=\"$outPath/lib/lib$PUBLIC_CRATE.cdylib\" ;; "
        + "    proc-macro) LIB=\"$outPath/lib/lib$PUBLIC_CRATE.proc-macro\" ;; "
        + "    *) echo \"rust_nix_build (%s): unsupported crate type $CRATE_TYPE\" >&2; exit 2 ;; " % raw
        + "  esac; "
        + "  if [ ! -f \"$LIB\" ]; then echo \"rust_nix_build (%s): expected compiled $CRATE_TYPE not found\" >&2; exit 2; fi; " % raw
        + "  cp -f \"$LIB\" \"$0\"; exit 0; "
        + "fi; "
        + "if [ \"%s\" = \"wasm\" ] || [ \"%s\" = \"wasi\" ]; then " % (kind, kind)
        + ("  WASM=\"$outPath/lib/%s.wasm\"; " % ctx.attrs.crate)
        + "  if [ ! -f \"$WASM\" ]; then echo \"rust_nix_build (%s): expected WebAssembly module not found\" >&2; exit 2; fi; " % raw
        + "  cp -f \"$WASM\" \"$0\"; exit 0; "
        + "fi; "
        + ("TARGET_NAME=\"%s\"; " % target_name)
        + ("PLANNER_TARGET_NAME=\"%s\"; " % planner_target_name)
        + ("SANITIZED=\"%s\"; " % sanitized)
        + "CAND=\"\"; "
        + "for c in \"$outPath/bin/$PLANNER_TARGET_NAME\" \"$outPath/bin/$TARGET_NAME\" \"$outPath/bin/$SANITIZED\" \"$outPath/bin/rust-$SANITIZED\"; do "
        + "  if [ -x \"$c\" ]; then CAND=\"$c\"; break; fi; "
        + "done; "
        + "if [ -z \"$CAND\" ]; then "
        + "  echo \"rust_nix_build (%s): expected binary not found\" >&2; " % raw
        + "  if [ -d \"$outPath\" ]; then ls -la \"$outPath\" >&2; fi; "
        + "  if [ -d \"$outPath/bin\" ]; then ls -la \"$outPath/bin\" >&2; fi; "
        + "  exit 2; "
        + "fi; "
        + "DEST=\"$0\"; cp -f \"$CAND\" \"$DEST\"; "
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    remote_inputs = [
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ]
    present_remote_inputs = [value for value in remote_inputs if value != None]
    crate_closure_inputs = rust_crate_closure_inputs(ctx)
    declared_inputs = nix_artifact_action_inputs(ctx) + [ctx.attrs.cargo_manifest, ctx.attrs.cargo_lock] + crate_closure_inputs + snapshot_inputs + present_remote_inputs + control_inputs
    cmd = cmd_args(
        [nix_artifact_bash(), "-c", run_and_copy, out.as_output(), ctx.attrs._graph_json] + snapshot_args + control_inputs + [declared_inputs],
        hidden = declared_inputs,
    )
    remote_requested = "remote:ready" in ctx.attrs.labels
    evidence = remote_ready_evidence(
        source_snapshot,
        source_snapshot_manifest,
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ) if remote_requested else None
    policy_info = run_nix_action(
        ctx,
        cmd,
        category = "rust_nix_build",
        declared_inputs = declared_inputs,
        mode = "remote-ready" if remote_requested else "local-only",
        evidence = evidence,
    )
    runtime_outputs = native_runtime_outputs(ctx.attrs.link_deps + ctx.attrs.header_deps)
    providers = [
        DefaultInfo(default_output = out, other_outputs = runtime_outputs),
        rust_crate_info(ctx),
    ]
    if crate_type == "staticlib":
        providers.append(NativeLinkInfo(
            library = out,
            link_kind = "static",
            link_name = ctx.attrs.public_crate or ctx.attrs.crate,
            runtime_outputs = runtime_outputs,
        ))
    return providers + policy_info

_ATTRS = {
        "self_label": attrs.string(),
        "planner_label": attrs.option(attrs.string(), default = None),
        "kind": attrs.string(),  # "bin" | "lib" | "wasm" | "wasi"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),
        "cargo_manifest": attrs.source(),
        "cargo_lock": attrs.source(),
        "cargo_output_hashes": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "cargo_fixed_sources": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "crate": attrs.string(),
        "features": attrs.list(attrs.string(), default = []),
        "default_features": attrs.bool(default = True),
        "profile": attrs.string(default = "release"),
        "target": attrs.string(default = ""),
        "source_snapshot": attrs.option(attrs.source(), default = None),
        "source_snapshot_bundle": attrs.option(attrs.dep(providers = [SourceSnapshotInfo]), default = None),
        "source_snapshot_manifest": attrs.option(attrs.source(), default = None),
        "materialization_manifest": attrs.option(attrs.source(), default = None),
        "artifact_contract": attrs.option(attrs.source(), default = None),
        "tool_closure": attrs.option(attrs.source(), default = None),
        "remote_builder_smoke": attrs.option(attrs.source(), default = None),
        "local_patch_dirs": attrs.list(attrs.string(), default = []),
        "nixpkgs_profile": attrs.string(default = "default"),
        "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
        "labels": attrs.list(attrs.string(), default = []),
        "_flake_file": attrs.source(default = "root//.viberoots/workspace:flake.nix"),
        "_flake_lock": attrs.source(default = "root//.viberoots/workspace:flake.lock"),
        "_node_modules_hashes": attrs.source(default = "root//projects/config:node-modules.hashes.json"),
        "_nixpkgs_registry_extension": attrs.source(default = "root//.viberoots/workspace:nixpkgs-source-registry-extension"),
        "_source_snapshot_validator": attrs.source(default = "@viberoots//build-tools/tools/dev:validate-source-snapshot.ts"),
}
_ATTRS.update(rust_crate_contract_attrs())

rust_nix_build = rule(
    impl = _rust_nix_build_impl,
    attrs = with_nix_artifact_action_attrs(_ATTRS),
)

__all__ = ["rust_nix_build"]
