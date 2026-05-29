load("@prelude//:rules.bzl", "genrule")
load("//build-tools/lang:importer_strings.bzl", "importer_display_name", "sanitize_importer_for_nix_attr")
load("//build-tools/lang:remote_action_policy.bzl", "stamp_local_only_genrule_labels")
load(
    "//build-tools/lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_env_export_nix_pnpm_fetch_timeout",
    "nix_build_out_path_cmd",
    "nix_calling_genrule_bootstrap",
    "nix_calling_node_patch_requirements_preflight",
)
load("//build-tools/node:defs_core.bzl", "nix_node_gen")
load(
    "//build-tools/node:defs_nix_helpers.bzl",
    "apply_default_lockfile_label",
    "prepare_node_importer_nix_calling_genrule_kwargs",
    "validate_optional_importer_arg_matches_wiring",
)
MODULE_PROVIDERS = {}
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")

def node_webapp(
    name,
    deps = [],
    labels = [],
    lockfile_label = None,
    importer = None,
    out = None,
    **kwargs
):
    kw = dict(kwargs) if kwargs != None else {}
    lockfile_label = apply_default_lockfile_label(lockfile_label, labels, "node_webapp")
    wiring = prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {},
        deps = deps,
        kind = "app",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    validate_optional_importer_arg_matches_wiring(
        importer = importer,
        wiring = wiring,
        macro_name = "node_webapp",
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            # Webapp Nix builds can exceed 4m on cold/local-first runs.
            # Keep a bounded timeout, but avoid premature SIGKILL at 240s.
            timeout_sec = 600,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_node_patch_requirements_preflight(_importer)
        + nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600)
        + "OUT_PATHS_FILE=\"$TMP/vbr-nix-outpaths.txt\"; "
        + (
            "$TIMEOUT node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
            + "\"$WORKSPACE_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts\" --attr "
            + ("\"node-webapp.%s\" > \"$OUT_PATHS_FILE\"; " % sanitize_importer_for_nix_attr(_importer))
        )
        + "OUT_LAST_FILE=\"$OUT_PATHS_FILE.last\"; "
        + "tail -n1 \"$OUT_PATHS_FILE\" > \"$OUT_LAST_FILE\"; "
        + "outPath=\"\"; read -r outPath < \"$OUT_LAST_FILE\" 2>/dev/null || true; "
        + "test -n \"$outPath\"; "
        + "mkdir -p \"$OUT_ABS\"; "
        + "if [ -d \"$outPath/dist\" ]; then cp -R \"$outPath/dist\" \"$OUT_ABS\"; chmod -R u+w \"$OUT_ABS\" 2>/dev/null || true; else echo 'dist missing' >&2; exit 2; fi"
    )

    kw["out"] = out if out != None else "dist"
    kw["cmd"] = cmd
    kw["labels"] = stamp_local_only_genrule_labels(kw.get("labels", []) or [])
    genrule(**kw)
def nix_node_cli_bin(
    name,
    entry = None,
    out = None,
    labels = [],
    deps = [],
    lockfile_label = None,
    bundle = False,
    importer = None,
    **kwargs
):
    if out == None:
        out = name
    if not bundle:
        if entry == None:
            entry = "bin/%s" % name
        lockfile_label = apply_default_lockfile_label(lockfile_label, labels, "nix_node_cli_bin(bundle=False)")
        impl_name = name + "__nix_impl"
        nix_node_gen(
            name = impl_name,
            srcs = [entry],
            out = out,
            cmd = "cp %s $OUT && chmod +x $OUT" % entry,
            deps = deps,
            labels = labels,
            lockfile_label = lockfile_label,
            kind = "bin",
            planner_only = True,
        )
        _srcs_map = {entry: entry}
        kw = dict(kwargs) if kwargs != None else {}
        wiring = prepare_node_importer_nix_calling_genrule_kwargs(
            name = name,
            kwargs = kw,
            srcs = _srcs_map,
            deps = deps,
            kind = "bin",
            MODULE_PROVIDERS = MODULE_PROVIDERS,
            labels = list(labels or []),
            lockfile_label = lockfile_label,
        )
        validate_optional_importer_arg_matches_wiring(
            importer = importer,
            wiring = wiring,
            macro_name = "nix_node_cli_bin(bundle=False)",
        )
        kw = wiring.kwargs
        impl_label = "//%s:%s__planner" % (native.package_name(), impl_name)
        cmd = (
            "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
            + nix_calling_genrule_bootstrap(
                # Bundled and selected CLI paths can exceed 3m under shared verify load.
                timeout_sec = 600,
                include_pnpm_store = False,
                source_workspace_root_env = True,
            )
            + nix_calling_env_export_buck_graph_json()
            + nix_calling_node_patch_requirements_preflight(wiring.importer)
            + nix_build_out_path_cmd(
                "\"path:$WORKSPACE_ROOT#graph-generator-selected\"",
                timeout_var = "TIMEOUT",
                impure = True,
                build_prefix = ("env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" " % impl_label),
            )
            + ("EXPECTED=\"$outPath/%s\"; " % out)
            + "if [ ! -f \"$EXPECTED\" ]; then "
            + "  echo \"nix_node_cli_bin(bundle=False): expected output missing: $EXPECTED\" >&2; "
            + "  (ls -la \"$outPath\" || true) >&2; "
            + "  exit 2; "
            + "fi; "
            + "cp -f \"$EXPECTED\" \"$OUT_ABS\"; "
            + "chmod +x \"$OUT_ABS\"; "
        )
        kw["out"] = out
        kw["cmd"] = cmd
        kw["labels"] = stamp_local_only_genrule_labels(kw.get("labels", []) or [])
        genrule(**kw)
        return
    if entry == None:
        entry = "src/index.ts"
    elif entry != "src/index.ts":
        fail(
            "nix_node_cli_bin(bundle=True) supports only entry='src/index.ts' (or omit entry). "
            + "If you need to copy a different entry file, use bundle=False."
        )
    _srcs_map = {entry: entry}
    kw = dict(kwargs) if kwargs != None else {}
    lockfile_label = apply_default_lockfile_label(lockfile_label, labels, "nix_node_cli_bin(bundle=True)")
    wiring = prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = _srcs_map,
        deps = deps,
        kind = "bin",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    validate_optional_importer_arg_matches_wiring(
        importer = importer,
        wiring = wiring,
        macro_name = "nix_node_cli_bin(bundle=True)",
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    bundle_name = importer_display_name(_importer)
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            # Bundled CLI builds regularly exceed 3m on cold/shared hosts.
            timeout_sec = 600,
            include_pnpm_store = True,
            source_workspace_root_env = True,
            skip_require_unified_pnpm_store = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_node_patch_requirements_preflight(_importer)
        + nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600)
        + "export NIX_PNPM_ALLOW_GENERATE=1; "
        + nix_build_out_path_cmd(
            "\"path:$WORKSPACE_ROOT#node-cli.%s\"" % sanitize_importer_for_nix_attr(_importer),
            timeout_var = "TIMEOUT",
            impure = True,
        )
        + ("EXPECTED=\"$outPath/%s.bundle.js\"; " % bundle_name)
        + "if [ ! -f \"$EXPECTED\" ]; then "
        + "  echo \"nix_node_cli_bin(bundle=True): expected bundle missing: $EXPECTED\" >&2; "
        + "  (ls -la \"$outPath\" || true) >&2; "
        + "  exit 2; "
        + "fi; "
        + "cp -f \"$EXPECTED\" \"$OUT_ABS\"; "
        + "chmod +x \"$OUT_ABS\"; "
    )
    kw["out"] = out
    kw["cmd"] = cmd
    kw["labels"] = stamp_local_only_genrule_labels(kw.get("labels", []) or [])
    genrule(**kw)
