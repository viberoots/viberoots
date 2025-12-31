load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "prepare_importer_nix_calling_genrule_wiring_v2")
load("//lang:importer_strings.bzl", "importer_display_name", "sanitize_importer_for_nix_attr")
load(
    "//lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_env_export_nix_pnpm_fetch_timeout",
    "nix_build_out_path_cmd",
    "nix_calling_genrule_bootstrap",
)
load("//node:defs_core.bzl", "nix_node_gen")

def _prepare_node_importer_nix_calling_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        kind,
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None):
    return prepare_importer_nix_calling_genrule_wiring_v2(
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
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {},
        deps = deps,
        kind = "app",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    cmd = (
        # Buck executes genrules from a generated srcs/ directory with OUT as a relative path.
        # Capture an absolute OUT path before we cd during nix bootstrap.
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
        if entry == None:
            entry = "bin/%s" % name
        # Copy only the CLI entry file to $OUT; provider stamps are included in srcs
        # for dependency edges but should not be passed to cp as multiple sources.
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

    # Bundled mode uses a fixed entry today (src/index.ts) via the flake implementation.
    # Do not accept arbitrary entries here; it would be ignored and would pollute action keys.
    if entry == None:
        entry = "src/index.ts"
    elif entry != "src/index.ts":
        fail(
            "nix_node_cli_bin(bundle=True) supports only entry='src/index.ts' (or omit entry). "
            + "If you need to copy a different entry file, use bundle=False."
        )

    # Build srcs map to place files at deterministic paths inside the action
    _srcs_map = {
        # Preserve entry path under bin/
        entry: entry,
    }

    kw = dict(kwargs) if kwargs != None else {}
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = _srcs_map,
        deps = deps,
        kind = "bin",
        labels = list(labels or []),
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    _importer = wiring.importer

    # Bundling may invoke Nix + PNPM and can legitimately take longer on cold caches.
    # Keep command assembly standardized via lang/nix_shell.bzl helpers:
    # - workspace-root env sourcing
    # - outPath capture via nix build --no-link --print-out-paths
    # - required env exports (BUCK_GRAPH_JSON, NIX_PNPM_FETCH_TIMEOUT)
    bundle_name = importer_display_name(_importer)
    cmd = (
        # Buck executes genrules from a generated srcs/ directory with OUT as a relative path.
        # Capture an absolute OUT path before we cd during nix bootstrap.
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


