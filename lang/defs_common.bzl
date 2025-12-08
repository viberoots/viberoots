load("//lang:nix_attr_aliases.bzl", "NIX_ATTR_ALIASES")

def normalize_labels(pkg, labels):
    if labels == None:
        return []
    if not isinstance(labels, list):
        fail("labels must be a list of string labels")
    out = []
    for l in labels:
        if not isinstance(l, str):
            fail("labels must be a list of string labels")
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


def include_package_local_patches(kwargs, lang, default_dirs = None):
    """
    Attach package-local patch directories into kwargs["srcs"] deterministically.
    - For languages that use package-local patch dirs (e.g., Go/C++).
    - Delegates to append_patch_srcs(...) and preserves order with deduplication.
    - If default_dirs is empty or invalid, falls back to ["patches/<lang>"].
    """
    if not isinstance(lang, str) or lang == "":
        return
    dirs = []
    if isinstance(default_dirs, list) and len(default_dirs) > 0:
        # Filter to strings only; ignore invalid entries
        for d in default_dirs:
            if isinstance(d, str) and d != "":
                dirs.append(d)
    if len(dirs) == 0:
        dirs = ["patches/%s" % lang]
    append_patch_srcs(kwargs, dirs)


def default_package_patch_dirs(lang):
    """
    Return the default package-local patch directories for a given language.
    Currently returns ["patches/<lang>"] and can be extended in future PRs.
    """
    if not isinstance(lang, str) or lang == "":
        return []
    return ["patches/%s" % lang]


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


def stamp_wasm_variant(kwargs, lang, variant):
    """
    Append deterministic WASM labels:
      - lang:<lang>
      - kind:wasm
      - wasm:<variant>
    """
    if not isinstance(lang, str) or lang == "":
        return
    if not isinstance(variant, str) or variant == "":
        return
    labels = kwargs.get("labels", []) or []
    stamps = ["lang:%s" % lang, "kind:wasm", "wasm:%s" % variant]
    kwargs["labels"] = dedupe_preserve(labels + stamps)

def _labels_file_impl(ctx):
    out = ctx.actions.declare_output(ctx.attrs.out)
    # Write one label per line for simple assertions
    ctx.actions.write(out, "\n".join(ctx.attrs.labels) + "\n")
    return [DefaultInfo(default_output = out)]

_labels_file = rule(
    impl = _labels_file_impl,
    attrs = {
        "labels": attrs.list(attrs.string(), default = []),
        "out": attrs.string(),
    },
)

def wasm_labels_probe(name, lang, variant, labels = []):
    """
    Test-only probe: stamps WASM labels and materializes them into an output file.
    Usage:
      wasm_labels_probe(name = "x", lang = "cpp", variant = "emscripten")
    Produces: x.labels.txt with each label on its own line.
    """
    kw = { "labels": (labels or []) }
    stamp_wasm_variant(kw, lang, variant)
    _labels_file(
        name = name,
        labels = kw.get("labels", []),
        out = name + ".labels.txt",
    )


def normalize_nix_attr(attr):
    """
    Normalize a nixpkgs attribute path for provider naming and labeling.
    - Trims
    - Lower-cases
    - Ensures "pkgs." prefix
    - Maps aliases from generated NIX_ATTR_ALIASES (JSON source of truth)
    - Sparse fallback: also map pkgs.gtest -> pkgs.googletest
    """
    if not isinstance(attr, str):
        return ""
    s = attr.strip().lower()
    if s == "":
        return ""
    if not s.startswith("pkgs."):
        s = "pkgs." + s
    # Prefer generated alias map when present
    if (s in NIX_ATTR_ALIASES):
        s = NIX_ATTR_ALIASES[s]
    # Sparse/partial clone fallback to preserve behavior when alias map is empty
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


# PR-4: Centralized helper to realize provider edges deterministically
def realize_provider_edges(MODULE_PROVIDERS, name, into = "deps", base = None):
    """
    Return a deduped list composed of base (if any) plus provider targets for //pkg:name.
    - into: "deps" | "srcs" (semantic only; returns a list to assign to that field)
    - base: existing list to merge with provider edges (defaults to [])
    """
    base_list = base if isinstance(base, list) else []
    provs = providers_for(MODULE_PROVIDERS, name)
    return dedupe_preserve(base_list + provs)


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


def package_local_patches_probe(name, lang, dirs = None):
    """
    Test-only helper: materialize package-local patch srcs into an output file.
    Uses include_package_local_patches(...) to populate srcs, then writes each
    entry on its own line via the labels file rule.
    Output file name: <name>.srcs.txt
    """
    kw = {}
    include_package_local_patches(kw, lang, dirs)
    _labels_file(
        name = name,
        labels = kw.get("srcs", []) or [],
        out = name + ".srcs.txt",
    )

