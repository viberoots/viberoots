load("//lang:lockfile_labels.bzl", "ensure_single_lockfile_label", "importer_from_labels")
load("//lang:label_stamping.bzl", "stamp_labels")
load(
    "//lang:patch_inputs.bzl",
    "include_importer_patches_from_labels",
    "include_importer_patches_from_labels_dict_safe",
)
load("//lang:provider_edges.bzl", "realize_provider_edges")
load("//lang:dict_inputs.bzl", "attach_items_dict_safe")
load("//lang:auto_map.bzl", _DEFAULT_MODULE_PROVIDERS = "MODULE_PROVIDERS")

def require_single_importer_lockfile_label(kwargs, lockfile_label):
    """
    Enforce exactly one importer-scoped lockfile label:
      lockfile:<path>#<importer>

    This preserves the stable error text and label de-dupe behavior from
    //lang:lockfile_labels.bzl.
    """
    ensure_single_lockfile_label(kwargs, lockfile_label)

def attach_importer_patch_inputs(kwargs, lang, into = "srcs", dict_safe = False, key_prefix = "__patch_inputs__"):
    """
    Attach importer-local patch files into kwargs[into].

    - When dict_safe = False, expects list-shaped attributes and uses native.glob.
    - When dict_safe = True, expects dict-shaped attributes (dest -> source) and attaches
      synthetic keys under key_prefix without changing caller-provided mappings.
    """
    if dict_safe:
        include_importer_patches_from_labels_dict_safe(kwargs, lang, into = into, key_prefix = key_prefix)
    else:
        include_importer_patches_from_labels(kwargs, lang, into = into)

def merge_provider_edges(
        name,
        deps,
        into = "deps",
        base = None,
        dict_safe = False,
        key_prefix = "__provider_edges__",
        MODULE_PROVIDERS = None):
    """
    Merge provider edges from MODULE_PROVIDERS for the current package target name.

    Shapes:
    - dict_safe = False: returns a list of deps/srcs merged with provider edges.
      - base may be None (defaults to deps), or a list.
      - base may also be a kwargs dict with base[into] list; forwarded to realize_provider_edges.
    - dict_safe = True: returns a dict-shaped input mapping (dest -> source) with provider edges
      attached under key_prefix. In this mode, base must be a dict-shaped mapping, and deps is a
      list of additional edge labels to include.
    """
    provs = _DEFAULT_MODULE_PROVIDERS if MODULE_PROVIDERS == None else MODULE_PROVIDERS

    if dict_safe:
        dst_to_src = {} if base == None else (dict(base) if isinstance(base, dict) else {})
        merged = realize_provider_edges(provs, name, into = into, base = (deps or []))
        return attach_items_dict_safe(dst_to_src, merged, key_prefix)

    merged_base = deps if base == None else base
    return realize_provider_edges(provs, name, into = into, base = merged_base)


def prepare_importer_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None,
        patch_key_prefix = "__patch_inputs__",
        provider_key_prefix = "__provider_edges__"):
    """
    Standard wiring for importer-scoped, genrule-style macros where edges must be realized
    into an input attribute (usually `srcs`) rather than `deps`.

    Responsibilities:
    - enforce exactly one importer-scoped lockfile label (stable error text)
    - stamp `lang:*` and `kind:*` labels
    - attach importer-local patch files into `srcs` (list and dict shapes)
    - realize provider edges into `srcs` (list and dict shapes)
    """
    kw = {} if kwargs == None else kwargs
    kw["name"] = name
    existing_labels = kw.get("labels", []) or []
    kw["labels"] = (existing_labels if isinstance(existing_labels, list) else []) + (labels or [])

    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_labels(kw, lang, kind)

    is_dict_srcs = isinstance(srcs, dict)
    kw["srcs"] = (dict(srcs) if is_dict_srcs else list(srcs))

    if is_dict_srcs:
        attach_importer_patch_inputs(kw, lang, into = "srcs", dict_safe = True, key_prefix = patch_key_prefix)
        kw["srcs"] = merge_provider_edges(
            name,
            deps,
            into = "srcs",
            base = (kw.get("srcs", {}) or {}),
            dict_safe = True,
            key_prefix = provider_key_prefix,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
        return kw

    attach_importer_patch_inputs(kw, lang, into = "srcs")
    merged_srcs = kw.get("srcs", []) or []
    kw["srcs"] = merge_provider_edges(
        name,
        (merged_srcs + (deps or [])),
        into = "srcs",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    return kw


def prepare_importer_non_genrule_wiring(
        name,
        kwargs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        patch_into = "srcs",
        patch_base = None,
        patch_dict_safe = None,
        patch_key_prefix = "__patch_inputs__",
        provider_into = "deps",
        provider_base = None,
        provider_dict_safe = None,
        provider_key_prefix = "__provider_edges__",
        MODULE_PROVIDERS = None):
    """
    Standard wiring for importer-scoped macros that do not follow the genrule-style path.

    Responsibilities:
    - enforce exactly one importer-scoped lockfile label (stable error text)
    - stamp `lang:*` and `kind:*` labels
    - derive and return the importer string from the lockfile label
    - attach importer-local patch inputs into a chosen attribute (list and dict shapes)
    - merge provider edges into deps by default, or into a chosen attribute for rule shapes that
      cannot accept deps
    """
    kw = {} if kwargs == None else kwargs
    kw["name"] = name

    existing_labels = kw.get("labels", []) or []
    kw["labels"] = (existing_labels if isinstance(existing_labels, list) else []) + (labels or [])

    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_labels(kw, lang, kind)
    importer = importer_from_labels(kw)

    if patch_into != None:
        if patch_base != None:
            kw[patch_into] = dict(patch_base) if isinstance(patch_base, dict) else list(patch_base)
        elif kw.get(patch_into) == None:
            kw[patch_into] = []

        is_dict = isinstance(kw.get(patch_into), dict)
        dict_safe = is_dict if patch_dict_safe == None else patch_dict_safe
        attach_importer_patch_inputs(kw, lang, into = patch_into, dict_safe = dict_safe, key_prefix = patch_key_prefix)

    wired_deps = deps
    if provider_into == "deps":
        wired_deps = merge_provider_edges(name, deps, MODULE_PROVIDERS = MODULE_PROVIDERS)
    else:
        base = provider_base if provider_base != None else kw.get(provider_into)
        is_dict = isinstance(base, dict)
        dict_safe = is_dict if provider_dict_safe == None else provider_dict_safe
        if base == None:
            base = {} if dict_safe else []
        kw[provider_into] = merge_provider_edges(
            name,
            deps,
            into = provider_into,
            base = base,
            dict_safe = dict_safe,
            key_prefix = provider_key_prefix,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )

    return {
        "importer": importer,
        "kwargs": kw,
        "deps": wired_deps,
    }

