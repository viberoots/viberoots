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


# PR-2: Shared lockfile label helpers for importer-scoped Node macros
def extract_lockfile_labels(labels):
    """
    Return labels that look like lockfile labels.
    Matches strings beginning with "lockfile:"; does not validate importer suffix here.
    """
    if labels == None:
        return []
    out = []
    for l in labels:
        if isinstance(l, str) and l.startswith("lockfile:"):
            out.append(l)
    return out


def ensure_single_lockfile_label(kwargs, lockfile_label):
    """
    Ensure kwargs carries exactly one importer-scoped lockfile label.
    - Optionally merges an explicit lockfile_label arg
    - Dedupes while preserving order
    - Error text is precise and stable (relied upon by tests)
    """
    labels = kwargs.get("labels", []) or []
    if lockfile_label != None and isinstance(lockfile_label, str) and lockfile_label != "":
        labels = labels + [lockfile_label]
    lf = extract_lockfile_labels(labels)
    if len(lf) != 1:
        fail("Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: %s" % lf)
    kwargs["labels"] = dedupe_preserve(labels)


def importer_from_labels(kwargs):
    """
    Enforce and extract the importer string from the single lockfile label.
    - Calls ensure_single_lockfile_label(kwargs, None) to validate and dedupe
    - Returns the importer (text after '#'), or "" if not present
    """
    ensure_single_lockfile_label(kwargs, None)
    labs = extract_lockfile_labels(kwargs.get("labels", []) or [])
    if len(labs) != 1:
        # Error text is produced by ensure_single_lockfile_label; this path should not occur.
        fail("Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: %s" % labs)
    lab = labs[0]
    return (lab.split("#")[1] if ("#" in lab) else "")


def include_importer_patches_from_labels(kwargs, lang):
    """
    Convenience helper to include importer-local patches in kwargs['srcs'].
    - Derives importer from labels via importer_from_labels
    - Appends "<importer>/patches/<lang>/*.patch" (or "patches/<lang>" when importer == ".")
    """
    imp = importer_from_labels(kwargs)
    if imp == None or imp == "":
        return
    append_importer_patches(kwargs, imp, lang)


def dedupe_preserve(seq):
    seen = {}
    out = []
    for x in seq:
        if x in seen:
            continue
        seen[x] = True
        out.append(x)
    return out


def append_patch_srcs(kwargs, dirs):
    """
    Append *.patch files from the given directories into kwargs["srcs"].
    Order is preserved and duplicates are removed.
    """
    srcs = kwargs.get("srcs", []) or []
    for d in dirs or []:
        if not isinstance(d, str):
            continue
        if d == "":
            continue
        srcs = srcs + native.glob(["%s/*.patch" % d])
    if len(srcs) > 0:
        kwargs["srcs"] = dedupe_preserve(srcs)


def append_importer_patches(kwargs, importer, lang):
    """
    Unified importer-local patches helper (PR‑5).
    Appends "<importer>/patches/<lang>/*.patch" (or "patches/<lang>" when importer == ".")
    into kwargs["srcs"] deterministically. No-ops on invalid args.
    """
    if importer == None or not isinstance(importer, str) or importer == "":
        return
    if lang == None or not isinstance(lang, str) or lang == "":
        return
    base = "patches/%s" % lang
    patch_dir = base if importer == "." else ("%s/%s" % (importer, base))
    append_patch_srcs(kwargs, [patch_dir])


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


def append_nixpkg_labels(kwargs, attrs):
    """
    Append normalized nixpkgs labels into kwargs["labels"].
    - Applies normalize_nix_attr() to each entry in attrs
    - Appends as "nixpkg:<normalized>"
    - Dedupes while preserving order
    - No-ops on non-string / empty values
    """
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


# PR-6: Starlark probe for nix attribute normalization
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
    """
    Test-only helper that materializes the normalized nix attr into a declared output.
    The output file name is the normalized value with a .txt suffix.
    """
    _normalize_nix_attr_probe(
        name = name,
        attr = attr,
        out = normalize_nix_attr(attr) + ".txt",
    )

# PR-2: Centralized provider lookup helpers shared by language macros
def target_key_for_current_package(name):
    """
    Compute the canonical target key for the current package.
    Example: "//pkg/path:target_name"
    """
    pkg = native.package_name()
    return "//%s:%s" % (pkg, name)


def providers_for(MODULE_PROVIDERS, name):
    """
    Return provider targets for the given rule name in the current package,
    looking up entries in the generated MODULE_PROVIDERS mapping.
    The mapping is expected to come from //third_party/providers:auto_map.bzl.
    """
    key = target_key_for_current_package(name)
    labels = MODULE_PROVIDERS.get(key, [])
    out = []
    for l in labels:
        if isinstance(l, str):
            out.append(l)
    return out


# Test-only: probe importer_from_labels by materializing it into an output file
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
    """
    Test-only helper that writes the importer string to a declared output.
    The output file name is the importer with a .txt suffix ('.' becomes 'dot').
    """
    imp = "."
    if isinstance(lockfile_label, str) and ("#" in lockfile_label):
        imp = lockfile_label.split("#")[1]
    out = ((imp if imp != "." else "dot") + ".txt")
    _importer_from_labels_probe(
        name = name,
        lockfile_label = lockfile_label,
        out = out,
    )

