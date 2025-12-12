load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:nix_attr_aliases.bzl", "NIX_ATTR_ALIASES")

def normalize_nix_attr(attr):
    if not isinstance(attr, str):
        return ""
    s = attr.strip().lower()
    if s == "":
        return ""
    if not s.startswith("pkgs."):
        s = "pkgs." + s
    if (s in NIX_ATTR_ALIASES):
        s = NIX_ATTR_ALIASES[s]
    if s == "pkgs.gtest":
        s = "pkgs.googletest"
    return s

def append_nixpkg_labels(kwargs, attrs):
    labels = kwargs.get("labels", []) or []
    extra = []
    for a in attrs or []:
        if not isinstance(a, str):
            continue
        na = normalize_nix_attr(a)
        if na == "":
            continue
        extra.append("nixpkg:%s" % na)
    if len(extra) > 0:
        kwargs["labels"] = dedupe_preserve(labels + extra)

def _normalize_nix_attr_probe_impl(ctx):
    val = normalize_nix_attr(ctx.attrs.attr)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, val + "\n")
    return [DefaultInfo(default_output = out)]

_normalize_nix_attr_probe = rule(
    impl = _normalize_nix_attr_probe_impl,
    attrs = {
        "attr": attrs.string(),
        "out": attrs.string(),
    },
)

def normalize_nix_attr_probe(name, attr):
    _normalize_nix_attr_probe(
        name = name,
        attr = attr,
        out = normalize_nix_attr(attr) + ".txt",
    )


