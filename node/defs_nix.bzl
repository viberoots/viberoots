load("//lang:defs_common.bzl", "stamp_global_nix_inputs", "importer_from_labels", "ensure_single_lockfile_label")
load("//lang:global_inputs.bzl", "attach_global_nix_inputs")
load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:nix_shell.bzl", "escape_buck_cmd_subst", "nix_bootstrap_env_core", "nix_bootstrap_env_pnpm_store", "nix_build_out_path_cmd", "nix_timeout_wrapper_var")
load("//node:defs_core.bzl", "nix_node_gen")

def _sanitize_importer_attr(s):
    # Use canonical sanitizer from //lang:sanitize.bzl (mirrors flake-side sanitizeName)
    return sanitize_name(s)

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
    # Enforce a single importer-scoped lockfile label and derive the importer via shared helpers
    kw = { "labels": (labels or []) }
    ensure_single_lockfile_label(kw, lockfile_label)
    _importer = importer_from_labels(kw)

    # Shim: build via Nix and copy dist/* into $OUT (single directory output)
    # Use escaped command substitutions: $$(...) so Buck doesn't parse $(...) as a target pattern.
    # Escape only command substitutions `$(...)` to avoid Buck interpreting them;
    # keep normal `$VAR` expansions intact.
    _prefix = escape_buck_cmd_subst(nix_bootstrap_env_core() + nix_bootstrap_env_pnpm_store()) + nix_timeout_wrapper_var(default_sec = 240)
    cmd = (
        _prefix
        + nix_build_out_path_cmd(".#node-webapp.%s" % _sanitize_importer_attr(_importer))
        + "if [ -d \"$outPath/dist\" ]; then cp -R \"$outPath/dist\" $OUT; else echo 'dist missing' >&2; exit 2; fi"
    )

    # Stamp global Nix inputs for macros that call Nix (policy: PR‑5/PR‑2)
    _stamp = { "labels": (labels or []) }
    stamp_global_nix_inputs(_stamp)
    stamped_labels = _stamp.get("labels", []) or []

    _inputs = { "srcs": [] }
    attach_global_nix_inputs(_inputs, into = "srcs")

    nix_node_gen(
        name = name,
        srcs = _inputs["srcs"],
        out = out if out != None else "dist",
        cmd = cmd,
        labels = stamped_labels,
        lockfile_label = lockfile_label,
        kind = "app",
        **kwargs
    )

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
    if entry == None:
        entry = "bin/%s" % name
    if out == None:
        out = name

    if not bundle:
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

    # Bundled mode: build a single-file shebanged bundle via the scaffolded importer's flake
    # Enforce a single importer-scoped lockfile label and derive the importer via shared helpers
    kw = { "labels": (labels or []) }
    ensure_single_lockfile_label(kw, lockfile_label)
    _importer = importer_from_labels(kw)

    def _basename_importer(s):
        # crude basename: split by '/' and take last non-empty
        parts = [p for p in s.split("/") if p != ""]
        return parts[-1] if len(parts) > 0 else s

    # Use Node shim to build single-file bundle via Nix and copy it to $OUT
    # Escape only command substitutions `$(...)`; keep `$VAR` expansions.
    # Establish WORKSPACE_ROOT/REPO_ROOT from BUCK_GRAPH_JSON BEFORE bootstrapping,
    # so nix_bootstrap_env_core computes FLK_ROOT deterministically to the temp repo root.
    _pre_env = (
        # Prefer explicit injection if provided by tests (temp repo path); otherwise, use the genrule sandbox root.
        ". tools/buck/workspace-root.env 2>/dev/null || true; "
        + "if [ -n \"${WORKSPACE_ROOT:-}\" ]; then export REPO_ROOT=\"$WORKSPACE_ROOT\"; fi; "
        + "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
    )
    # Bundling may invoke Nix + PNPM and can legitimately take longer than 60s on cold caches.
    _bootstrap = escape_buck_cmd_subst(nix_bootstrap_env_core() + nix_bootstrap_env_pnpm_store())
    _prefix = _pre_env + _bootstrap + nix_timeout_wrapper_var(default_sec = 180)
    cmd = (
        "SCRATCH=\"$PWD\"; "
        + _prefix
        + "OUT_ABS=\"$SCRATCH/$OUT\"; "
        + "export NIX_PNPM_FETCH_TIMEOUT=\"${NIX_PNPM_FETCH_TIMEOUT:-60}\"; "
        + "set -x; "
        + "command -v nix >/dev/null 2>&1 || { echo '[BNX-BUNDLE] nix not found in PATH' >&2; exit 96; }; "
        + "command -v node >/dev/null 2>&1 || { echo '[BNX-BUNDLE] node not found in PATH' >&2; exit 97; }; "
        + "if [ -f \"$FLK_ROOT/flake.nix\" ]; then echo '[BNX-BUNDLE-DEBUG] flake.nix present at '$FLK_ROOT >&2; else echo '[BNX-BUNDLE-DEBUG] flake.nix MISSING at '$FLK_ROOT', listing dir:' >&2; ls -la \"$FLK_ROOT\" >&2 || true; exit 95; fi; "
        + "if [ -f \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "  { echo -n '[BNX-BUNDLE-DEBUG] unified_pnpm_store=' >&2; cat \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" 2>/dev/null >&2 || true; echo '' >&2; }; "
        + "else echo '[BNX-BUNDLE-DEBUG] unified_pnpm_store=missing' >&2; fi; "
        + "ls -la \"$FLK_ROOT/buck-out/.unified-pnpm-store\" >/dev/null 2>&1 || true; "
        + "cd \"${WORKSPACE_ROOT:-$FLK_ROOT}\"; "
        + "export BUCK_GRAPH_JSON=\"$FLK_ROOT/tools/buck/graph.json\"; "
        + "export NIX_PNPM_ALLOW_GENERATE=1; "
        + "DBG_LOG=\"$SCRATCH/bundle-debug.log\"; : > \"$DBG_LOG\"; "
        + ("$TIMEOUT node --experimental-strip-types --experimental-top-level-await --disable-warning=ExperimentalWarning "
           + "\"${WORKSPACE_ROOT:-$FLK_ROOT}/tools/buck/node-cli-bundle.ts\" --importer \"%s\" --name \"%s\" --out \"$OUT_ABS\" >> \"$DBG_LOG\" 2>&1 " % (_importer, _basename_importer(_importer)))
        + "; RC=$?; echo '[BNX-BUNDLE-DEBUG] bundler-exit='$RC >&2; sed -n '1,200p' \"$DBG_LOG\" >&2 || true; "
        + "exit $RC"
    )

    # Stamp global Nix inputs when bundling (macro calls Nix)
    _stamp = { "labels": (labels or []) }
    stamp_global_nix_inputs(_stamp)
    stamped_labels = _stamp.get("labels", []) or []

    # Build srcs map to place files at deterministic paths inside the action
    _srcs_map = {
        # Preserve entry path under bin/
        entry: entry,
        # Optional workspace root injection
        "tools/buck/workspace-root.env": "root//tools/buck:workspace-root.env",
    }

    _inputs = { "srcs": _srcs_map }
    attach_global_nix_inputs(_inputs, into = "srcs")

    nix_node_gen(
        name = name,
        # Include the CLI entry and the repo graph file to allow deriving repo root hermetically
        srcs = _inputs["srcs"],
        out = out,
        cmd = cmd,
        deps = deps,
        labels = stamped_labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )


