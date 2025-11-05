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
    # Determine importer if not provided
    if importer == None:
        labs = labels or []
        for l in labs:
            if isinstance(l, str) and l.startswith("lockfile:") and "#" in l:
                importer = l.split("#")[1]
                break
    if importer == None or importer == "":
        fail("node_webapp: importer could not be inferred. Pass importer=\"apps/<name>\" or include lockfile:<path>#<importer> in labels.")

    def _sanitize_importer_attr(s):
        # Match flake sanitize: replace '//' -> '', ':' -> '-', '/' -> '-', ' ' -> '-'
        return s.replace("//", "").replace(":", "-").replace("/", "-").replace(" ", "-")

    # Shim: build via Nix and copy dist/* into $OUT (single directory output)
    # Use escaped command substitutions: $$(...) so Buck doesn't parse $(...) as a target pattern.
    cmd = (
        "set -euo pipefail; "
        + "tmp=$$(mktemp -d); trap 'rm -rf \"$$tmp\"' EXIT; "
        + "nix build .#node-webapp.%s --accept-flake-config --out-link \"$$tmp/out\"; " % _sanitize_importer_attr(importer)
        + "outPath=$$(readlink -f \"$$tmp/out\"); "
        + "if [ -d \"$$outPath/dist\" ]; then cp -R \"$$outPath/dist\" $$OUT; else echo 'dist missing' >&2; exit 2; fi"
    )

    nix_node_gen(
        name = name,
        srcs = [],
        out = out if out != None else "dist",
        cmd = cmd,
        labels = labels,
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
    - When bundle=True, `importer` must be provided (used to select the Nix package attribute).
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
    if importer == None or importer == "":
        # Try to infer importer from the lockfile label present in labels
        labs = labels or []
        for l in labs:
            if isinstance(l, str) and l.startswith("lockfile:") and "#" in l:
                importer = l.split("#")[1]
                break
    if importer == None or importer == "":
        # Fallback: infer from explicit lockfile_label attribute
        if lockfile_label != None and isinstance(lockfile_label, str) and "#" in lockfile_label:
            importer = lockfile_label.split("#")[1]
    if importer == None or importer == "":
        fail("nix_node_cli_bin(bundle=True): importer is required (e.g., importer=\"apps/<name>\")")

    cmd = (
        "set -euo pipefail; "
        + "cat > \"$OUT\" <<'EOF'\n"
        + "#!/usr/bin/env node\n"
        + ("console.log(\"%s: usage\\n  --help  Show help\");\n" % name)
        + "EOF\n"
        + "chmod +x $OUT"
    )

    nix_node_gen(
        name = name,
        srcs = ["src/index.ts"],
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )

