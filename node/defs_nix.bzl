load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "default_lockfile_label_from_package", "default_lockfile_path_from_package", "ensure_default_lockfile_exists", "extract_lockfile_labels", "importer_from_labels", "prepare_language_wiring")
load("//lang:importer_strings.bzl", "importer_display_name", "sanitize_importer_for_nix_attr")
load(
    "//lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_env_export_nix_pnpm_fetch_timeout",
    "nix_build_out_path_cmd",
    "nix_calling_genrule_bootstrap",
)
load("//node:defs_core.bzl", "nix_node_gen")

MODULE_PROVIDERS = {}
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def _fail_importer_arg_mismatch(macro_name, importer, lockfile_importer, lockfile_label):
    fail(
        ("%s: importer must match the importer suffix in the single lockfile label; " % macro_name) +
        ("importer=%s lockfile_importer=%s lockfile_label=%s" % (importer, lockfile_importer, lockfile_label))
    )

def _effective_lockfile_label_from_wiring(wiring):
    lf = extract_lockfile_labels(wiring.kwargs.get("labels", []) or [])
    if len(lf) == 1:
        return lf[0]
    return lf

def _validate_optional_importer_arg_matches_wiring(importer, wiring, macro_name):
    if importer == None:
        return
    if importer != wiring.importer:
        _fail_importer_arg_mismatch(
            macro_name = macro_name,
            importer = importer,
            lockfile_importer = wiring.importer,
            lockfile_label = _effective_lockfile_label_from_wiring(wiring),
        )

def _validate_optional_importer_arg_matches_single_lockfile_label(importer, lockfile_label, labels, macro_name):
    if importer == None:
        return
    kw = {"labels": list(labels or [])}
    if lockfile_label != None:
        kw["labels"] = (kw.get("labels", []) or []) + [lockfile_label]
    derived = importer_from_labels(kw)
    lf = extract_lockfile_labels(kw.get("labels", []) or [])
    effective = lf[0] if len(lf) == 1 else lf
    if importer != derived:
        _fail_importer_arg_mismatch(
            macro_name = macro_name,
            importer = importer,
            lockfile_importer = derived,
            lockfile_label = effective,
        )

def _apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, macro_name)
        return default_lockfile_label_from_package()
    return lockfile_label

def _prepare_node_importer_nix_calling_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        kind,
        labels = [],
        lockfile_label = None):
    return prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        srcs = srcs,
        deps = deps,
        lang = "node",
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        inject_workspace_root_env = True,
        global_inputs_into = "srcs",
        global_inputs_stamp = True,
        wiring = "nix_calling_genrule",
    )

def node_webapp(
    name,
    deps = [],
    labels = [],
    lockfile_label = None,
    importer = None,
    out = None,
    **kwargs
):
    """
    Build a Vite webapp via a hermetic Nix derivation and copy its dist/ into $OUT.

    - Requires exactly one importer-scoped lockfile label (lockfile:<path>#<importer>).
    - `importer` is optional; if omitted, derive from the lockfile label's importer suffix.
    - Runs `nix build .#node-webapp.<importer>` and copies dist/.
    """
    kw = dict(kwargs) if kwargs != None else {}
    lockfile_label = _apply_default_lockfile_label(lockfile_label, labels, "node_webapp")
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {},
        deps = deps,
        kind = "app",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    _validate_optional_importer_arg_matches_wiring(
        importer = importer,
        wiring = wiring,
        macro_name = "node_webapp",
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_sec = 240,
            include_pnpm_store = True,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600)
        + nix_build_out_path_cmd(
            "\"path:$WORKSPACE_ROOT#node-webapp.%s\"" % sanitize_importer_for_nix_attr(_importer),
            timeout_var = "TIMEOUT",
            impure = False,
        )
        + "mkdir -p \"$OUT_ABS\"; "
        + "if [ -d \"$outPath/dist\" ]; then cp -R \"$outPath/dist\" \"$OUT_ABS\"; else echo 'dist missing' >&2; exit 2; fi"
    )

    kw["out"] = out if out != None else "dist"
    kw["cmd"] = cmd
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
    """
    Materialize a Node CLI binary.

    - Shim mode (default): copies `entry` (defaults to bin/<name>) to $OUT and chmod +x.
    - Bundled mode (bundle = True): builds a single-file shebanged bundle via Nix and copies it to $OUT.

    Notes:
    - Exactly one importer-scoped lockfile label must be present (lockfile:<path>#<importer>).
    - When bundle=True, the importer is derived from the single lockfile label via shared helpers
      (importer_from_labels); no explicit `importer` argument is required.
    """
    if out == None:
        out = name

    if not bundle:
        _validate_optional_importer_arg_matches_single_lockfile_label(
            importer = importer,
            lockfile_label = lockfile_label,
            labels = labels,
            macro_name = "nix_node_cli_bin(bundle=False)",
        )
        if entry == None:
            entry = "bin/%s" % name
        nix_node_gen(
            name = name,
            srcs = [entry],
            out = out,
            cmd = "cp %s $OUT && chmod +x $OUT" % entry,
            deps = deps,
            labels = labels,
            lockfile_label = lockfile_label,
            kind = "bin",
            **kwargs
        )
        return

    if entry == None:
        entry = "src/index.ts"
    elif entry != "src/index.ts":
        fail(
            "nix_node_cli_bin(bundle=True) supports only entry='src/index.ts' (or omit entry). "
            + "If you need to copy a different entry file, use bundle=False."
        )

    _srcs_map = {
        entry: entry,
    }

    kw = dict(kwargs) if kwargs != None else {}
    lockfile_label = _apply_default_lockfile_label(lockfile_label, labels, "nix_node_cli_bin(bundle=True)")
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = _srcs_map,
        deps = deps,
        kind = "bin",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    _validate_optional_importer_arg_matches_wiring(
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
            timeout_sec = 180,
            include_pnpm_store = True,
            source_workspace_root_env = True,
            skip_require_unified_pnpm_store = True,
        )
        + nix_calling_env_export_buck_graph_json()
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
    genrule(**kw)
