load("@prelude//:rules.bzl", "genrule")
load("@viberoots//build-tools/lang:importer_strings.bzl", "sanitize_importer_for_nix_attr")
load(
    "@viberoots//build-tools/lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_env_export_nix_pnpm_fetch_timeout",
    "nix_calling_genrule_bootstrap",
    "nix_calling_node_patch_requirements_preflight",
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

def _validate_vercel_config_path(vercel_config):
    if not isinstance(vercel_config, str) or vercel_config == "":
        fail("node_vercel_next_artifact: vercel_config must be a non-empty relative path")
    if vercel_config.startswith("/") or vercel_config.find("\\") >= 0:
        fail("node_vercel_next_artifact: vercel_config must be a package-relative path")
    blocked_chars = [
        " ",
        "\"",
        "'",
        "$",
        "`",
        ";",
        "&",
        "|",
        "<",
        ">",
        "(",
        ")",
        "[",
        "]",
        "{",
        "}",
        "\n",
        "\r",
        "\t",
        "*",
        "?",
    ]
    for bad in blocked_chars:
        if vercel_config.find(bad) >= 0:
            fail(
                "node_vercel_next_artifact: vercel_config contains an unsupported character: %s" %
                vercel_config
            )
    parts = vercel_config.split("/")
    for part in parts:
        if part == "" or part == "." or part == "..":
            fail(
                "node_vercel_next_artifact: vercel_config must not contain empty, '.', or '..' segments"
            )

def node_vercel_next_artifact(
        name,
        labels = [],
        lockfile_label = None,
        importer = None,
        vercel_config = "vercel.project.json",
        out = None,
        **kwargs):
    _validate_vercel_config_path(vercel_config)
    kw = dict(kwargs) if kwargs != None else {}
    macro_labels = [
        "webapp:ssr",
        "framework:next",
        "deployable:app",
        "deployment-component:ssr-webapp",
        "vercel:prebuilt",
    ] + list(labels or [])
    lockfile_label = apply_default_lockfile_label(
        lockfile_label,
        macro_labels,
        "node_vercel_next_artifact",
    )
    wiring = prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {vercel_config: vercel_config},
        deps = [],
        kind = "app",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        labels = macro_labels,
        lockfile_label = lockfile_label,
    )
    validate_optional_importer_arg_matches_wiring(
        importer = importer,
        wiring = wiring,
        macro_name = "node_vercel_next_artifact",
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
        + ("export VBR_VERCEL_CONFIG=%s; " % sh_quote(vercel_config))
        + "OUT_PATHS_FILE=\"$TMP/vbr-nix-outpaths.txt\"; "
        + (
            "$TIMEOUT node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
            + "\"$WORKSPACE_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts\" --attr "
            + ("\"node-vercel-next.%s\" > \"$OUT_PATHS_FILE\"; " % sanitize_importer_for_nix_attr(_importer))
        )
        + "OUT_LAST_FILE=\"$OUT_PATHS_FILE.last\"; "
        + "tail -n1 \"$OUT_PATHS_FILE\" > \"$OUT_LAST_FILE\"; "
        + "outPath=\"\"; read -r outPath < \"$OUT_LAST_FILE\" 2>/dev/null || true; "
        + "test -n \"$outPath\"; "
        + "rm -rf \"$OUT_ABS\"; mkdir -p \"$OUT_ABS\"; "
        + "cp -R \"$outPath\"/. \"$OUT_ABS\"/; "
        + "test -d \"$OUT_ABS/.vercel/output\"; "
        + "test -f \"$OUT_ABS/artifact-identity.json\""
    )
    kw["out"] = out if out != None else "vercel-prebuilt"
    kw["cmd"] = cmd
    kw["labels"] = stamp_local_only_genrule_labels(kw.get("labels", []) or [])
    genrule(**kw)
