load("//lang:lockfile_labels.bzl", "ensure_single_lockfile_label", "importer_from_labels")
load("//lang:label_stamping.bzl", "stamp_labels", "stamp_patch_scope_for_lang")
load("//lang:importer_package_boundary.bzl", "require_importer_package_boundary")
load(
    "//lang:patch_inputs.bzl",
    "include_importer_patches_from_labels",
    "include_importer_patches_from_labels_dict_safe",
)
load("//lang:dict_inputs.bzl", "PATCH_INPUTS_KEY_PREFIX")

def require_single_importer_lockfile_label(kwargs, lockfile_label):
    """
    Enforce exactly one importer-scoped lockfile label:
      lockfile:<path>#<importer>

    This preserves the stable error text and label de-dupe behavior from
    //lang:lockfile_labels.bzl.
    """
    ensure_single_lockfile_label(kwargs, lockfile_label)

def attach_importer_patch_inputs(kwargs, lang, into = "srcs", dict_safe = False, key_prefix = PATCH_INPUTS_KEY_PREFIX):
    """
    Attach importer-local patch files into kwargs[into].

    - When dict_safe = False, expects list-shaped attributes and uses native.glob.
    - When dict_safe = True, expects dict-shaped attributes (dest -> source) and attaches
      synthetic keys under key_prefix without changing caller-provided mappings.
    """
    require_importer_package_boundary(importer_from_labels(kwargs))
    if dict_safe:
        include_importer_patches_from_labels_dict_safe(kwargs, lang, into = into, key_prefix = key_prefix)
    else:
        include_importer_patches_from_labels(kwargs, lang, into = into)

