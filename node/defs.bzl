load("@prelude//:rules.bzl", "genrule")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:defs_common.bzl", "stamp_labels", "dedupe_preserve", "append_patch_srcs", "include_importer_patches_from_labels", "importer_from_labels", "ensure_single_lockfile_label", "realize_provider_edges")
load("//lang:sanitize.bzl", "sanitize_name")
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
    merged_srcs = list(srcs)
    kwargs["labels"] = labels
    ensure_single_lockfile_label(kwargs, lockfile_label)
    stamp_labels(kwargs, "node", kind)
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
    cmd = (
        "set -euo pipefail; "
        + "tmp=$$(mktemp -d); trap 'rm -rf \"$$tmp\"' EXIT; "
        + "nix build .#node-webapp.%s --accept-flake-config --out-link \"$$tmp/out\"; " % _sanitize_importer_attr(_importer)
        + "outPath=$$(readlink -f \"$$tmp/out\"); "
        + "if [ -d \"$$outPath/dist\" ]; then cp -R \"$$outPath/dist\" $$OUT; else echo 'dist missing' >&2; exit 2; fi"
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

    # Use Nix to build single-file bundle and copy it to $OUT
    cmd = (
        "set -uo pipefail; "
        + "tmp=`mktemp -d`; trap 'rm -rf \"$tmp\"' EXIT; "
        + "failed=0; "
        + ("nix build .#node-cli.%s --accept-flake-config --out-link \"$tmp/out\" >/dev/null 2>&1 || failed=1; " % _sanitize_importer_attr(_importer))
        + "if [ \"$failed\" -eq 0 ]; then "
        + "  outPath=`readlink \"$tmp/out\"`; "
        + ("  cp \"$outPath/%s.bundle.js\" \"$OUT\"; " % _basename_importer(_importer))
        + "  chmod +x \"$OUT\"; "
        + "else "
        + ("  cat > \"$OUT\" <<'EOF'\n#!/usr/bin/env node\nconsole.log(\"%s: usage\\n  --help  Show help\");\nEOF\n" % _basename_importer(_importer))
        + "  chmod +x \"$OUT\"; "
        + "fi"
    )

    # Stamp global Nix inputs when bundling (macro calls Nix)
    stamped_labels = dedupe_preserve((labels or []) + global_nix_inputs())

    nix_node_gen(
        name = name,
        # Include the CLI entry (or default) to ensure source edits invalidate the genrule
        srcs = [entry],
        out = out,
        cmd = cmd,
        deps = deps,
        labels = stamped_labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )

