load("//lang:collections.bzl", "dedupe_preserve")

def extract_lockfile_labels(labels):
    if labels == None:
        return []
    out = []
    for l in labels:
        if isinstance(l, str) and l.startswith("lockfile:"):
            out.append(l)
    return out

def _parse_importer_scoped_lockfile_label(label):
    if not (isinstance(label, str) and label.startswith("lockfile:")):
        fail("Lockfile label must start with 'lockfile:'; got: %s" % label)
    raw = label[len("lockfile:"):]
    if raw == "":
        fail("Lockfile label must be of the form lockfile:<path>#<importer>; got: %s" % label)
    if "#" not in raw:
        fail("Lockfile label must be of the form lockfile:<path>#<importer> (missing '#<importer>'); got: %s" % label)
    if raw.count("#") != 1:
        fail("Lockfile label must contain exactly one '#'; got: %s" % label)
    path_part, importer = raw.split("#")
    if path_part == "" or importer == "":
        fail("Lockfile label must be of the form lockfile:<path>#<importer>; got: %s" % label)
    return (path_part, importer)

def ensure_single_lockfile_label(kwargs, lockfile_label):
    labels = kwargs.get("labels", []) or []
    if lockfile_label != None and isinstance(lockfile_label, str) and lockfile_label != "":
        labels = labels + [lockfile_label]
    lf = extract_lockfile_labels(labels)
    if len(lf) != 1:
        fail("Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: %s" % lf)
    _parse_importer_scoped_lockfile_label(lf[0])
    kwargs["labels"] = dedupe_preserve(labels)

def importer_from_labels(kwargs):
    ensure_single_lockfile_label(kwargs, None)
    labs = extract_lockfile_labels(kwargs.get("labels", []) or [])
    if len(labs) != 1:
        fail("Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: %s" % labs)
    _, importer = _parse_importer_scoped_lockfile_label(labs[0])
    return importer

def _importer_from_labels_probe_impl(ctx):
    kw = { "labels": [] }
    lf = ctx.attrs.lockfile_label
    if isinstance(lf, str) and lf != "":
        kw["labels"] = [lf]
    imp = importer_from_labels(kw)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, imp + "\n")
    return [DefaultInfo(default_output = out)]

_importer_from_labels_probe = rule(
    impl = _importer_from_labels_probe_impl,
    attrs = {
        "lockfile_label": attrs.string(),
        "out": attrs.string(),
    },
)

def importer_from_labels_probe(name, lockfile_label):
    # Output filename is stable and derived from the importer when present.
    imp = "."
    if isinstance(lockfile_label, str):
        # Best-effort derivation for output file naming only; parsing/validation happens in the rule impl.
        parts = lockfile_label.split("#")
        if len(parts) == 2 and parts[1] != "":
            imp = parts[1]
    out = ((imp if imp != "." else "dot") + ".txt")
    _importer_from_labels_probe(
        name = name,
        lockfile_label = lockfile_label,
        out = out,
    )


