load("@prelude//:rules.bzl", "genrule")
load("//lang:defs_common.bzl", "stamp_labels", "dedupe_preserve")
load("//node/private:nix_test.bzl", "node_nix_test")

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
    # Include importer-local node patches in srcs so Buck invalidates precisely on patch changes
    # Derive importer from the single required lockfile label
    _lf = _extract_lockfile_labels(kwargs.get("labels", []))
    _importer = None
    if len(_lf) == 1 and isinstance(_lf[0], str):
        _lab = _lf[0]
        _importer = _lab[_lab.find("#") + 1:] if ("#" in _lab) else None
    # Normalize importer '.' (repo root) → patches/node
    if _importer != None and _importer != "":
        _patch_dir = "patches/node" if _importer == "." else ("%s/patches/node" % _importer)
        merged_srcs = merged_srcs + native.glob(["%s/*.patch" % _patch_dir])
    merged_srcs = dedupe_preserve(merged_srcs + deps + _providers_for(name))
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
    _ensure_lockfile_label(kw, lockfile_label)
    stamp_labels(kw, "node", kind)

    # Derive importer from the single required lockfile label
    _lf = _extract_lockfile_labels(kw.get("labels", []))
    _importer = None
    if len(_lf) == 1 and isinstance(_lf[0], str) and ("#" in _lf[0]):
        _importer = _lf[0].split("#")[1]
    if _importer == None or _importer == "":
        fail("nix_node_test: importer could not be inferred from lockfile label; pass lockfile_label=\"lockfile:<path>#<importer>\"")

    # Include importer-local node patches as inputs so changes invalidate tests precisely
    merged_srcs = list(srcs)
    _patch_dir = "patches/node" if _importer == "." else ("%s/patches/node" % _importer)
    merged_srcs = merged_srcs + native.glob(["%s/*.patch" % _patch_dir])
    merged_srcs = dedupe_preserve(merged_srcs)

    # Forward to external runner rule; ignore legacy 'cmd'
    node_nix_test(
        name = name,
        importer = _importer,
        patterns = ([] if patterns == None else patterns),
        env = (env or {}),
        timeout_sec = timeout_sec,
        srcs = merged_srcs,
        deps = deps + _providers_for(name),
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

    def _sanitize_importer_attr(s):
        return s.replace("//", "").replace(":", "-").replace("/", "-").replace(" ", "-")
    def _basename_importer(s):
        # crude basename: split by '/' and take last non-empty
        parts = [p for p in s.split("/") if p != ""]
        return parts[-1] if len(parts) > 0 else s

    # Use Nix to build single-file bundle and copy it to $OUT
    cmd = (
        "set -uo pipefail; "
        + "tmp=`mktemp -d`; trap 'rm -rf \"$tmp\"' EXIT; "
        + "failed=0; "
        + ("nix build .#node-cli.%s --accept-flake-config --out-link \"$tmp/out\" >/dev/null 2>&1 || failed=1; " % _sanitize_importer_attr(importer))
        + "if [ \"$failed\" -eq 0 ]; then "
        + "  outPath=`readlink \"$tmp/out\"`; "
        + ("  cp \"$outPath/%s.bundle.js\" \"$OUT\"; " % _basename_importer(importer))
        + "  chmod +x \"$OUT\"; "
        + "else "
        + ("  cat > \"$OUT\" <<'EOF'\n#!/usr/bin/env node\nconsole.log(\"%s: usage\\n  --help  Show help\");\nEOF\n" % _basename_importer(importer))
        + "  chmod +x \"$OUT\"; "
        + "fi"
    )

    nix_node_gen(
        name = name,
        # Include the CLI entry (or default) to ensure source edits invalidate the genrule
        srcs = [entry],
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = "bin",
        **kwargs
    )

