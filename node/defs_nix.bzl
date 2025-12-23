load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "prepare_importer_nix_calling_genrule_wiring")
load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:nix_shell.bzl", "nix_calling_genrule_bootstrap", "nix_calling_genrule_nix_build_out_path_prefix")
load("//node:defs_core.bzl", "nix_node_gen")

def _sanitize_importer_attr(s):
    # Use canonical sanitizer from //lang:sanitize.bzl (mirrors flake-side sanitizeName)
    return sanitize_name(s)

def _pop_list(kwargs, key):
    if kwargs == None:
        return []
    v = kwargs.pop(key, [])
    return v if isinstance(v, list) else []

def _prepare_node_importer_nix_calling_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        kind,
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None):
    return prepare_importer_nix_calling_genrule_wiring(
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
    - Uses a zx shim to run `nix build .#node-webapp.<importer>` and copies dist/.
    """
    kw = dict(kwargs) if kwargs != None else {}
    kw["labels"] = list(labels or [])
    deps = _pop_list(kw, "deps")
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = {},
        deps = deps,
        kind = "app",
        labels = [],
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    _importer = wiring.importer
    cmd = (
        nix_calling_genrule_nix_build_out_path_prefix(
            ".#node-webapp.%s" % _sanitize_importer_attr(_importer),
            timeout_sec = 240,
            include_pnpm_store = True,
            source_workspace_root_env = True,
        )
        + "if [ -d \"$outPath/dist\" ]; then cp -R \"$outPath/dist\" $OUT; else echo 'dist missing' >&2; exit 2; fi"
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

    def _basename_importer(s):
        # crude basename: split by '/' and take last non-empty
        parts = [p for p in s.split("/") if p != ""]
        return parts[-1] if len(parts) > 0 else s

    # Build srcs map to place files at deterministic paths inside the action
    _srcs_map = {
        # Preserve entry path under bin/
        entry: entry,
    }

    kw = dict(kwargs) if kwargs != None else {}
    kw["labels"] = list(labels or [])
    wiring = _prepare_node_importer_nix_calling_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = _srcs_map,
        deps = deps,
        kind = "bin",
        labels = [],
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    _importer = wiring.importer

    # Bundling may invoke Nix + PNPM and can legitimately take longer than 60s on cold caches.
    _prefix = nix_calling_genrule_bootstrap(
        timeout_sec = 180,
        include_pnpm_store = True,
        source_workspace_root_env = True,
        skip_require_unified_pnpm_store = True,
    )

    cmd = (
        "SCRATCH=\"$PWD\"; "
        + _prefix
        + "OUT_ABS=\"$SCRATCH/$OUT\"; "
        + "export NIX_PNPM_FETCH_TIMEOUT=\"${NIX_PNPM_FETCH_TIMEOUT:-60}\"; "
        + "command -v nix >/dev/null 2>&1 || { echo '[BNX-BUNDLE] nix not found in PATH' >&2; exit 96; }; "
        + "command -v node >/dev/null 2>&1 || { echo '[BNX-BUNDLE] node not found in PATH' >&2; exit 97; }; "
        + "if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then echo '[BNX-BUNDLE] flake.nix not found at '$FLK_ROOT >&2; exit 95; fi; "
        + "cd \"${WORKSPACE_ROOT:-$FLK_ROOT}\"; "
        + "export BUCK_GRAPH_JSON=\"$FLK_ROOT/tools/buck/graph.json\"; "
        + "export NIX_PNPM_ALLOW_GENERATE=1; "
        + "DBG_LOG=\"$SCRATCH/bundle-debug.log\"; : > \"$DBG_LOG\"; "
        + ("$TIMEOUT node --experimental-strip-types --experimental-top-level-await --disable-warning=ExperimentalWarning "
           + "\"${WORKSPACE_ROOT:-$FLK_ROOT}/tools/buck/node-cli-bundle.ts\" --importer \"%s\" --name \"%s\" --out \"$OUT_ABS\" >> \"$DBG_LOG\" 2>&1 " % (_importer, _basename_importer(_importer)))
        + "; RC=$?; if [ \"$RC\" != \"0\" ]; then sed -n '1,200p' \"$DBG_LOG\" >&2 || true; fi; exit $RC"
    )

    kw["out"] = out
    kw["cmd"] = cmd
    genrule(**kw)


