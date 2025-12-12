load("@prelude//:rules.bzl", "genrule")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:defs_common.bzl", "stamp_labels", "dedupe_preserve", "append_patch_srcs", "include_importer_patches_from_labels", "importer_from_labels", "ensure_single_lockfile_label", "realize_provider_edges")
load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:nix_shell.bzl", "nix_bootstrap_env", "nix_timeout_wrapper_var")
load("//node/private:nix_test.bzl", "node_nix_test")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _sanitize_importer_attr(s):
    # Use canonical sanitizer from //lang:sanitize.bzl (mirrors flake-side sanitizeName)
    return sanitize_name(s)

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs):
    kwargs["name"] = name
    # Merge explicit deps and provider deps into srcs so edges are realized even if genrule doesn't support `deps`.
    _srcs_is_dict = isinstance(srcs, dict)
    merged_srcs = (dict(srcs) if _srcs_is_dict else list(srcs))
    kwargs["labels"] = labels
    ensure_single_lockfile_label(kwargs, lockfile_label)
    stamp_labels(kwargs, "node", kind)
    if _srcs_is_dict:
        # When srcs is a dict mapping dest->source, preserve mapping and skip patch inclusion into srcs.
        # Provider edges will still be realized into deps below.
        kwargs["srcs"] = merged_srcs
    else:
        # Include importer-local node patches in srcs so Buck invalidates precisely on patch changes
        kwargs["srcs"] = merged_srcs
        include_importer_patches_from_labels(kwargs, "node")
        merged_srcs = kwargs.get("srcs", [])
        merged_srcs = realize_provider_edges(MODULE_PROVIDERS, name, into = "srcs", base = (merged_srcs + deps))
        kwargs["srcs"] = merged_srcs
    if out != None:
        kwargs["out"] = out
    if cmd != None:
        kwargs["cmd"] = cmd
    genrule(**kwargs)

def nix_node_test(
    name,
    # Backward-compat args (ignored by runner; 'out' forwarded for stamp name)
    srcs = [],
    out = None,
    cmd = None,
    # New runner args
    patterns = None,
    env = {},
    timeout_sec = 600,
    deps = [],
    labels = [],
    lockfile_label = None,
    kind = "test",
    **kwargs
):
    # Prepare kwargs and label stamping
    kw = { "name": name }
    kw["labels"] = labels or []
    ensure_single_lockfile_label(kw, lockfile_label)
    stamp_labels(kw, "node", kind)

    # Derive importer from the single required lockfile label (shared helper)
    _importer = importer_from_labels(kw)

    # Include importer-local node patches as inputs so changes invalidate tests precisely
    merged_srcs = list(srcs)
    kw["srcs"] = merged_srcs
    include_importer_patches_from_labels(kw, "node")
    merged_srcs = dedupe_preserve(kw.get("srcs", []) or [])

    # Forward to external runner rule; ignore legacy 'cmd'
    node_nix_test(
        name = name,
        importer = _importer,
        patterns = ([] if patterns == None else patterns),
        env = (env or {}),
        timeout_sec = timeout_sec,
        srcs = merged_srcs,
        deps = realize_provider_edges(MODULE_PROVIDERS, name, base = deps),
        labels = kw.get("labels", []),
        out = (out if out != None else (name + ".stamp")),
        **kwargs
    )

def nix_node_lib(name, **kwargs):
    nix_node_gen(name = name, kind = "lib", **kwargs)

def nix_node_bin(name, **kwargs):
    nix_node_gen(name = name, kind = "bin", **kwargs)



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
    _prefix = nix_bootstrap_env().replace("$(", "$$(") + nix_timeout_wrapper_var(default_sec = 240)
    cmd = (
        _prefix
        + "outPath=$$($TIMEOUT nix build .#node-webapp.%s --accept-flake-config --no-link --print-out-paths | tail -n1); " % _sanitize_importer_attr(_importer)
        + "if [ -d \"$outPath/dist\" ]; then cp -R \"$outPath/dist\" $OUT; else echo 'dist missing' >&2; exit 2; fi"
    )

    # Stamp global Nix inputs for macros that call Nix (policy: PR‑5/PR‑2)
    stamped_labels = dedupe_preserve((labels or []) + global_nix_inputs())

    nix_node_gen(
        name = name,
        srcs = [],
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
    # so nix_bootstrap_env computes FLK_ROOT deterministically to the temp repo root.
    _pre_env = (
        # Prefer explicit injection if provided by tests (temp repo path); otherwise, use the genrule sandbox root.
        ". tools/buck/workspace-root.env 2>/dev/null || true; "
        + "if [ -n \"${WORKSPACE_ROOT:-}\" ]; then export REPO_ROOT=\"$WORKSPACE_ROOT\"; fi; "
        + "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
    )
    # Bundling may invoke Nix + PNPM and can legitimately take longer than 60s on cold caches.
    _prefix = _pre_env + nix_bootstrap_env().replace("$(", "$$(") + nix_timeout_wrapper_var(default_sec = 180)
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
    stamped_labels = dedupe_preserve((labels or []) + global_nix_inputs())

    # Build srcs map to place files at deterministic paths inside the action
    _srcs_map = {
        # Preserve entry path under bin/
        entry: entry,
        # Optional workspace root injection
        "tools/buck/workspace-root.env": "root//tools/buck:workspace-root.env",
    }
    nix_node_gen(
        name = name,
        # Include the CLI entry and the repo graph file to allow deriving repo root hermetically
        srcs = _srcs_map,
        out = out,
        cmd = cmd,
        deps = deps,
        labels = stamped_labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )

