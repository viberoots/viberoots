load("@prelude//:rules.bzl", "genrule")
load("@viberoots//build-tools/lang:importer_strings.bzl", "sanitize_importer_for_nix_attr")
load(
    "@viberoots//build-tools/lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_env_export_nix_pnpm_fetch_timeout",
    "nix_calling_genrule_bootstrap",
    "nix_calling_node_patch_requirements_preflight",
    "nix_declared_action_transport_args",
)
load(
    "@viberoots//build-tools/node:defs_nix_helpers.bzl",
    "apply_default_lockfile_label",
    "prepare_node_importer_nix_calling_genrule_kwargs",
    "validate_optional_importer_arg_matches_wiring",
)
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "stamp_local_only_genrule_labels")
load("@viberoots//build-tools/node/private:wasm_source_resolver.bzl", "sh_quote")

MODULE_PROVIDERS = {}
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")

def _validate_contract_path(runtime_contract):
    if not isinstance(runtime_contract, str) or runtime_contract == "":
        fail("node_service_artifact: runtime_contract must be a non-empty relative path")
    if runtime_contract.startswith("/") or runtime_contract.find("\\") >= 0:
        fail("node_service_artifact: runtime_contract must be package-relative")
    for part in runtime_contract.split("/"):
        if part == "" or part == "." or part == "..":
            fail("node_service_artifact: runtime_contract must not contain empty, '.', or '..' segments")

def node_service_artifact(
        name,
        labels = [],
        lockfile_label = None,
        importer = None,
        runtime_contract = "service.runtime.json",
        out = None,
        deps = [],
        **kwargs):
    _validate_contract_path(runtime_contract)
    kw = dict(kwargs) if kwargs != None else {}
    macro_labels = [
        "service:node",
        "deployable:app",
        "deployment-component:service",
        "artifact:node-service",
    ] + list(labels or [])
    lockfile_label = apply_default_lockfile_label(
        lockfile_label,
        macro_labels,
        "node_service_artifact",
    )
    wiring = prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {runtime_contract: runtime_contract},
        deps = deps,
        kind = "app",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        labels = macro_labels,
        lockfile_label = lockfile_label,
    )
    validate_optional_importer_arg_matches_wiring(
        importer = importer,
        wiring = wiring,
        macro_name = "node_service_artifact",
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_sec = 600,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_node_patch_requirements_preflight(_importer)
        + nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600)
        + ("export VBR_NODE_SERVICE_CONTRACT=%s; " % sh_quote(runtime_contract))
        + "OUT_PATHS_FILE=\"$TMP/vbr-nix-outpaths.txt\"; "
        + (
            "$TIMEOUT node --experimental-top-level-await --disable-warning=ExperimentalWarning "
            + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
            + "\"$VIBEROOTS_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts\" --attr "
            + ("\"node-service.%s\" --target \"//%s:%s\" --buck-action-inputs \"$VBR_BUCK_INPUTS\" " % (sanitize_importer_for_nix_attr(_importer), native.package_name(), name))
            + nix_declared_action_transport_args()
            + " $VBR_DEV_OVERRIDE_ARG > \"$OUT_PATHS_FILE\"; "
        )
        + "OUT_LAST_FILE=\"$OUT_PATHS_FILE.last\"; "
        + "tail -n1 \"$OUT_PATHS_FILE\" > \"$OUT_LAST_FILE\"; "
        + "outPath=\"\"; read -r outPath < \"$OUT_LAST_FILE\" 2>/dev/null || true; test -n \"$outPath\"; "
        + "rm -rf \"$OUT_ABS\"; mkdir -p \"$OUT_ABS\"; "
        + "cp -R \"$outPath\"/. \"$OUT_ABS\"/; "
        + "test -f \"$OUT_ABS/runtime-contract.json\"; "
        + "test -f \"$OUT_ABS/artifact-identity.json\""
    )
    kw["out"] = out if out != None else "node-service"
    kw["cmd"] = cmd
    kw["labels"] = stamp_local_only_genrule_labels(kw.get("labels", []) or [])
    genrule(**kw)
