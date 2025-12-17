load("//lang:collections.bzl", "dedupe_preserve")

def extract_lockfile_labels(labels):
    if labels == None:
        return []
    out = []
    for l in labels:
        if isinstance(l, str) and l.startswith("lockfile:"):
            out.append(l)
    return out

def _strip_leading_dot_slash(path_part):
    # Normalize "lockfile:./apps/web/pnpm-lock.yaml#apps/web" to "apps/web/pnpm-lock.yaml"
    # so TS/Starlark/Nix agree on the canonical lockfile path representation.
    if path_part.startswith("./"):
        return _strip_leading_dot_slash(path_part[2:])
    return path_part

def _dirname_posix(path_part):
    # Minimal posix dirname (paths in labels are always forward-slash-separated).
    if "/" not in path_part:
        return "."
    parts = path_part.split("/")
    # If the path ends with a slash (shouldn't), fall back to '.'
    if len(parts) <= 1:
        return "."
    return "/".join(parts[:-1])

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
    path_part = _strip_leading_dot_slash(path_part)
    dirname = _dirname_posix(path_part)
    if importer == ".":
        if dirname != ".":
            fail(
                "Lockfile label importer '.' is only allowed for repo-root lockfiles; expected importer '%s' for %s"
                % (dirname, label)
            )
    elif importer != dirname:
        fail(
            "Lockfile label importer must match the lockfile directory (%s); got: %s"
            % (dirname, label)
        )
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

def _lockfile_label_parse_probe_impl(ctx):
    lf = ctx.attrs.lockfile_label
    if not (isinstance(lf, str) and lf != ""):
        fail("lockfile_label_parse_probe requires lockfile_label to be a non-empty string")
    path_part, importer = _parse_importer_scoped_lockfile_label(lf)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(
        out,
        "{\"lockfile\":\"%s\",\"importer\":\"%s\"}\n" % (path_part, importer),
    )
    return [DefaultInfo(default_output = out)]

_lockfile_label_parse_probe = rule(
    impl = _lockfile_label_parse_probe_impl,
    attrs = {
        "lockfile_label": attrs.string(),
        "out": attrs.string(),
    },
)

def lockfile_label_parse_probe(name, lockfile_label):
    # Output filename is stable and derived from the importer when present.
    imp = "."
    if isinstance(lockfile_label, str):
        parts = lockfile_label.split("#")
        if len(parts) == 2 and parts[1] != "":
            imp = parts[1]
    out = ((imp if imp != "." else "dot") + ".json")
    _lockfile_label_parse_probe(
        name = name,
        lockfile_label = lockfile_label,
        out = out,
    )


