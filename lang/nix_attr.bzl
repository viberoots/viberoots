def _drop_config_suffix(label):
    # Buck2 appends config suffixes after a space and "(...)".
    # We mirror tools/lib/labels.ts:dropConfigSuffix by splitting on " (".
    if not isinstance(label, str):
        return ""
    return label.split(" (")[0]


def _drop_cell_prefix(label):
    # Mirror tools/lib/labels.ts:dropCellPrefix:
    # - "//foo:bar" stays as-is
    # - "root//foo:bar" becomes "//foo:bar"
    # - labels with no "//" are unchanged
    if not isinstance(label, str):
        return ""
    s = label
    if s.startswith("//"):
        return s
    idx = s.find("//")
    if idx < 0:
        return s
    return "//" + s[idx + 2:]


def normalize_target_label(label):
    if not isinstance(label, str):
        return ""
    return _drop_cell_prefix(_drop_config_suffix(label))


def sanitize_nix_attr_from_target_label(label):
    # Match tools/lib/labels.ts:sanitizeAttrNameFromLabel:
    # - normalize (drop cell prefix + config suffix)
    # - lowercase
    # - map non [a-z0-9_] to "_"
    # - prefix with "t"
    base = normalize_target_label(label).lower()
    out = ""
    for i in range(len(base)):
        c = base[i]
        is_alpha = (c >= "a" and c <= "z")
        is_num = (c >= "0" and c <= "9")
        out = out + (c if (is_alpha or is_num or c == "_") else "_")
    return "t" + out


def _sanitize_nix_attr_probe_impl(ctx):
    val = sanitize_nix_attr_from_target_label(ctx.attrs.label)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, val + "\n")
    return [DefaultInfo(default_output = out)]


_sanitize_nix_attr_probe = rule(
    impl = _sanitize_nix_attr_probe_impl,
    attrs = {
        "label": attrs.string(),
        "out": attrs.string(),
    },
)


def sanitize_nix_attr_from_target_label_probe(name, label):
    val = sanitize_nix_attr_from_target_label(label)
    _sanitize_nix_attr_probe(
        name = name,
        label = label,
        out = val + ".txt",
    )


__all__ = [
    "normalize_target_label",
    "sanitize_nix_attr_from_target_label",
    "sanitize_nix_attr_from_target_label_probe",
]


