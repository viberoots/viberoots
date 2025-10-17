load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "stamp_labels", "dedupe_preserve")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def _extract_lockfile_labels(labels):
    out = []
    for l in labels or []:
        if isinstance(l, str) and l.startswith("lockfile:"):
            out.append(l)
    return out

def _ensure_lockfile_label(kwargs, lockfile_label):
    labels = kwargs.get("labels", []) or []
    if lockfile_label != None and isinstance(lockfile_label, str) and lockfile_label != "":
        labels = labels + [lockfile_label]
    lf = _extract_lockfile_labels(labels)
    if len(lf) != 1:
        fail("Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: %s" % lf)
    kwargs["labels"] = dedupe_preserve(labels)

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs):
    kwargs["name"] = name
    # Merge explicit deps and provider deps into srcs so edges are realized even if genrule doesn't support `deps`.
    merged_srcs = list(srcs)
    kwargs["labels"] = labels
    _ensure_lockfile_label(kwargs, lockfile_label)
    stamp_labels(kwargs, "node", kind)
    merged_srcs = dedupe_preserve(merged_srcs + deps + _providers_for(name))
    kwargs["srcs"] = merged_srcs
    if out != None:
        kwargs["out"] = out
    if cmd != None:
        kwargs["cmd"] = cmd
    genrule(**kwargs)

def nix_node_test(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "test", **kwargs):
    nix_node_gen(
        name = name,
        srcs = srcs,
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = kind,
        **kwargs
    )

def nix_node_lib(name, **kwargs):
    nix_node_gen(name = name, kind = "lib", **kwargs)

def nix_node_bin(name, **kwargs):
    nix_node_gen(name = name, kind = "bin", **kwargs)



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
    - When bundle=True, `importer` must be provided (used to select the Nix package attribute).
    """
    if entry == None:
        entry = "bin/%s" % name
    if out == None:
        out = name

    if not bundle:
        nix_node_gen(
            name = name,
            srcs = [entry],
            out = out,
            cmd = "cp $SRCS $OUT && chmod +x $OUT",
            deps = deps,
            labels = labels,
            lockfile_label = lockfile_label,
            kind = "bin",
            **kwargs
        )
        return

    # Bundled mode: build a single-file shebanged bundle via Nix-provided esbuild
    if entry == None or entry == "":
        entry = "src/index.ts"

    cmd = (
        "set -euo pipefail; "
        + "ENTRY=\"$SRCS\"; "
        + "nix shell --accept-flake-config nixpkgs#esbuild nixpkgs#nodejs_22 -c esbuild \"$ENTRY\" "
        + "--platform=node --target=node22 --bundle --format=esm --legal-comments=none "
        + "--banner:js='#!/usr/bin/env node' --outfile=\"$OUT\"; "
        + "chmod +x $OUT"
    )

    nix_node_gen(
        name = name,
        srcs = [entry],
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )

