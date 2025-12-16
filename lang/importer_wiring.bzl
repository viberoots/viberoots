load("//lang:lockfile_labels.bzl", "ensure_single_lockfile_label")
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


