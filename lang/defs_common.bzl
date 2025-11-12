def normalize_labels(pkg, labels):
    if labels == None:
        return []
    if not isinstance(labels, list):
        fail("extra_module_providers must be a list of string labels")
    out = []
    for l in labels:
        if not isinstance(l, str):
            fail("extra_module_providers must be a list of string labels")
        if l.startswith(":"):
            out.append("//%s:%s" % (pkg, l[1:]))
        else:
            out.append(l)
    return out


def dedupe_preserve(seq):
    seen = {}
    out = []
    for x in seq:
        if x in seen:
            continue
        seen[x] = True
        out.append(x)
    return out


def normalize_build_tags(tags):
    s = {}
    for t in tags or []:
        if not isinstance(t, str):
            continue
        s[t.lower()] = True
    return sorted(s.keys())


def append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled):
    labels = kwargs.pop("labels", [])
    extra = []
    norm_tags = normalize_build_tags(build_tags)
    if len(norm_tags) > 0:
        extra.append("gotags:" + ",".join(norm_tags))
    if isinstance(goos, str) and goos != "":
        extra.append("goenv:GOOS=" + goos.lower())
    if isinstance(goarch, str) and goarch != "":
        extra.append("goenv:GOARCH=" + goarch.lower())
    if cgo_enabled != None:
        extra.append("goenv:CGO_ENABLED=" + ("1" if bool(cgo_enabled) else "0"))
    kwargs["labels"] = labels + extra



def stamp_labels(kwargs, lang, kind=None):
    """
    Ensure kwargs["labels"] contains the language stamp (e.g., "lang:go")
    and optional kind stamp (e.g., "kind:bin"|"kind:lib"|"kind:test").
    Labels are deduped while preserving order.
    """
    labels = kwargs.get("labels", []) or []
    stamps = ["lang:%s" % lang]
    if kind != None and isinstance(kind, str) and kind != "":
        stamps.append("kind:%s" % kind)
    kwargs["labels"] = dedupe_preserve(labels + stamps)


def normalize_nix_attr(attr):
    """
    Normalize a nixpkgs attribute path for provider naming and labeling.
    - Trims
    - Lower-cases
    - Ensures "pkgs." prefix
    - Maps historical alias pkgs.gtest -> pkgs.googletest
    """
    if not isinstance(attr, str):
        return ""
    s = attr.strip().lower()
    if s == "":
        return ""
    if not s.startswith("pkgs."):
        s = "pkgs." + s
    if s == "pkgs.gtest":
        s = "pkgs.googletest"
    return s

