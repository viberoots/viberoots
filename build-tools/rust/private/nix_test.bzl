load("@prelude//:build_mode.bzl", "BuildModeInfo")
load("@prelude//decls:re_test_common.bzl", "re_test_common")
load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")
load("@prelude//tests:re_utils.bzl", "get_re_executors_from_props")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_bootstrap_env_core", "nix_calling_env_export_source_snapshot", "nix_calling_env_materialize_source_snapshot_for_execution", "nix_declared_action_inputs_manifest_cmd", "nix_timeout_wrapper_var")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "external_runner_command", "remote_ready_evidence", "stamp_remote_readiness_labels", "write_nix_test_stamp")
load("@viberoots//build-tools/lang:source_snapshot.bzl", "SourceSnapshotInfo")
load("@viberoots//build-tools/rust/private:crate_contract.bzl", "rust_crate_closure_inputs", "rust_crate_contract_attrs", "rust_crate_info")

def _remote_test_attrs():
    test_attrs = re_test_common.test_args()
    test_attrs["remote_execution_action_key_providers"] = attrs.dep(
        providers = [BuildModeInfo],
        default = "repo_toolchains//:remote_profile_conversion_action_key",
    )
    return test_attrs

def _rust_nix_test_impl(ctx):
    source_snapshot = ctx.attrs.source_snapshot
    source_snapshot_manifest = ctx.attrs.source_snapshot_manifest
    if ctx.attrs.source_snapshot_bundle != None:
        if source_snapshot != None or source_snapshot_manifest != None:
            fail("source_snapshot_bundle cannot be combined with source_snapshot or source_snapshot_manifest")
        snapshot_info = ctx.attrs.source_snapshot_bundle[SourceSnapshotInfo]
        source_snapshot = snapshot_info.snapshot
        source_snapshot_manifest = snapshot_info.manifest
    raw = ctx.attrs.self_label
    planner_label = ctx.attrs.planner_label or raw
    labels = stamp_remote_readiness_labels(ctx.attrs.labels)
    remote_requested = "remote:ready" in labels
    snapshot_inputs = []
    if source_snapshot != None:
        snapshot_inputs.append(source_snapshot)
    if source_snapshot_manifest != None:
        snapshot_inputs.append(source_snapshot_manifest)
    snapshot_labels = []
    if source_snapshot != None and source_snapshot_manifest != None:
        snapshot_labels = ["source-snapshot:declared-root", "source-snapshot:manifest", "source-snapshot:graph"]
    snapshot_args = [source_snapshot or "", source_snapshot_manifest or ""]
    control_inputs = [
        ctx.attrs._flake_file,
        ctx.attrs._flake_lock,
        ctx.attrs._node_modules_hashes,
        ctx.attrs._nixpkgs_registry_extension,
        ctx.attrs._source_snapshot_validator,
    ]
    evidence_inputs = [
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ] if remote_requested else []
    declared_inputs = nix_artifact_action_inputs(ctx) + rust_crate_closure_inputs(ctx) + [
        ctx.attrs.cargo_manifest,
        ctx.attrs.cargo_lock,
    ] + snapshot_inputs + evidence_inputs + control_inputs
    safe_log = (
        "SAFE_LOG_KEY=\"%s\"; " % raw +
        "SAFE_LOG_KEY=\"${SAFE_LOG_KEY//\\//_}\"; SAFE_LOG_KEY=\"${SAFE_LOG_KEY//:/_}\"; " +
        "BUILD_SELECTED_LOG=\"$TMP/build-selected/rust_nix_test.${SAFE_LOG_KEY}.log\"; " +
        "mkdir -p \"$(dirname \"$BUILD_SELECTED_LOG\")\"; "
    )
    run_test = (
        "GRAPH_ARG=\"${1:-}\"; WORKSPACE_ROOT_ENV_ARG=\"${2:-}\"; " +
        "if [ -f \"$WORKSPACE_ROOT_ENV_ARG\" ]; then . \"$WORKSPACE_ROOT_ENV_ARG\"; fi; " +
        nix_bootstrap_env_core() +
        nix_declared_action_inputs_manifest_cmd() +
        nix_calling_env_export_source_snapshot(snapshot_root = "${3:-}", manifest_path = "${4:-}") +
        "if [ -n \"${3:-}\" ]; then \"$VBR_ARTIFACT_TOOLS_ROOT/bin/node\" --disable-warning=ExperimentalWarning --experimental-strip-types \"${9:-}\" \"${3:-}\" \"${4:-}\"; fi; " +
        nix_calling_env_materialize_source_snapshot_for_execution(
            snapshot_root = "${3:-}",
            flake_file = "${5:-}",
            flake_lock = "${6:-}",
            node_modules_hashes = "${7:-}",
            nixpkgs_registry_extension = "${8:-}",
        ) +
        safe_log +
        "COVERAGE_ARG=\"\"; case \"${COVERAGE:-}\" in \"\"|0) ;; 1) COVERAGE_ARG=--coverage ;; *) echo 'rust_nix_test: COVERAGE must be empty, 0, or 1' >&2; exit 2 ;; esac; unset COVERAGE; " +
        nix_action_build_selected_out_path_cmd(
            target_label = planner_label,
            out_var = "OUT_PATH",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$BUILD_SELECTED_LOG",
            graph_json_arg = "${BUCK_GRAPH_JSON:-$GRAPH_ARG}",
            extra_args = "$COVERAGE_ARG",
        ) +
        "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then " +
        "  test ! -f \"$BUILD_SELECTED_LOG\" || cat \"$BUILD_SELECTED_LOG\" >&2; " +
        "  if [ \"$NIX_STATUS\" -ne 0 ]; then exit \"$NIX_STATUS\"; fi; " +
        "  echo 'rust_nix_test: build-selected produced no output path' >&2; exit 2; " +
        "fi; TEST_BIN=\"$OUT_PATH/bin/%s\"; " % ctx.label.name +
        "if [ ! -x \"$TEST_BIN\" ]; then echo 'rust_nix_test: expected test runner is absent' >&2; exit 2; fi; " +
        "if [ -n \"$COVERAGE_ARG\" ] && [ -f \"$OUT_PATH/coverage/lcov.info\" ]; then " +
        "  COVERAGE_DIR=\"$WORKSPACE_ROOT/coverage/rust/$SAFE_LOG_KEY\"; mkdir -p \"$COVERAGE_DIR\"; " +
        "  cp \"$OUT_PATH/coverage/lcov.info\" \"$COVERAGE_DIR/lcov.info\"; " +
        "fi; " +
        "shift %s; " % (9 + len(declared_inputs)) +
        nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600) +
        "$TIMEOUT \"$TEST_BIN\" \"$@\""
    )
    remote_runner = ctx.actions.write(
        ctx.attrs.out + ".remote-runner",
        "#!%s\n%s\n" % (nix_artifact_bash(), run_test),
        is_executable = True,
    )
    declared_inputs.append(remote_runner)
    remote_command = [remote_runner, ctx.attrs._graph_json, ctx.attrs._workspace_root_env] + snapshot_args + control_inputs + declared_inputs[:-1]
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    re_executor, executor_overrides = get_re_executors_from_props(ctx)
    labels = labels + snapshot_labels
    policy_mode = "remote-ready" if "remote:ready" in labels else "local-only"
    policy_evidence = remote_ready_evidence(
        source_snapshot,
        source_snapshot_manifest,
        ctx.attrs.materialization_manifest,
        ctx.attrs.artifact_contract,
        ctx.attrs.tool_closure,
        ctx.attrs.remote_builder_smoke,
    ) if policy_mode == "remote-ready" else None
    policy_info = write_nix_test_stamp(
        ctx,
        stamp,
        "rust_nix_test\n",
        mode = policy_mode,
        evidence = policy_evidence,
    )
    command = external_runner_command(
        labels,
        [nix_artifact_bash(), "-c", run_test, "rust_nix_test", ctx.attrs._graph_json, ctx.attrs._workspace_root_env] + snapshot_args + control_inputs + declared_inputs[:-1],
        remote_command = remote_command,
        declared_inputs = declared_inputs,
        required_inputs = [
            remote_runner,
            ctx.attrs._build_selected,
            ctx.attrs._graph_json,
            ctx.attrs._workspace_root_env,
            ctx.attrs._zx_init,
        ] + snapshot_inputs + evidence_inputs + control_inputs,
    )
    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
        type = "rust",
        command = command,
        labels = labels,
        contacts = [],
        default_executor = re_executor,
        executor_overrides = executor_overrides,
        run_from_project_root = True,
        use_project_relative_paths = True,
    )) + [DefaultInfo(default_output = stamp), rust_crate_info(ctx)] + policy_info

_ATTRS = {
    "self_label": attrs.string(),
    "planner_label": attrs.option(attrs.string(), default = None),
    "kind": attrs.string(),
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
    "behavior_probe": attrs.bool(default = False),
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
    "test_rule_timeout_ms": attrs.option(attrs.int(), default = None),
    "_flake_file": attrs.source(default = "root//.viberoots/workspace:flake.nix"),
    "_flake_lock": attrs.source(default = "root//.viberoots/workspace:flake.lock"),
    "_node_modules_hashes": attrs.source(default = "root//projects/config:node-modules.hashes.json"),
    "_nixpkgs_registry_extension": attrs.source(default = "root//.viberoots/workspace:nixpkgs-source-registry-extension"),
    "_source_snapshot_validator": attrs.source(default = "@viberoots//build-tools/tools/dev:validate-source-snapshot.ts"),
    "_inject_test_env": attrs.default_only(attrs.dep(default = "prelude//test/tools:inject_test_env")),
}
_ATTRS.update(rust_crate_contract_attrs())
_ATTRS = with_nix_artifact_action_attrs(_ATTRS)
_ATTRS.update(_remote_test_attrs())

rust_nix_test = rule(impl = _rust_nix_test_impl, attrs = _ATTRS)

__all__ = ["rust_nix_test"]
