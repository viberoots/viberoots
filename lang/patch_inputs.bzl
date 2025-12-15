load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:labels_file.bzl", "labels_file")
load("//lang:lockfile_labels.bzl", "importer_from_labels")
load("//lang:dict_inputs.bzl", "attach_items_dict_safe")

def append_patch_inputs(kwargs, dirs, into = "srcs"):
    if kwargs == None:
        return
    if not isinstance(kwargs, dict):
        return
    if not isinstance(into, str) or into == "":
        return

    existing = kwargs.get(into, None)
    if existing == None:
        existing = []

    # Some rules use dict-shaped srcs (mapping dest -> source). Do not mutate that shape.
    if isinstance(existing, dict):
        return
    merged = existing
    for d in dirs or []:
        if not isinstance(d, str):
            continue
        if d == "":
            continue
        merged = merged + native.glob(["%s/*.patch" % d])
    if len(merged) > 0:
        kwargs[into] = dedupe_preserve(merged)

def append_patch_inputs_dict_safe(kwargs, dirs, into = "srcs", key_prefix = "__patch_inputs__"):
    if kwargs == None:
        return
    if not isinstance(kwargs, dict):
        return
    if not isinstance(into, str) or into == "":
        return

    if not isinstance(key_prefix, str) or key_prefix == "":
        key_prefix = "__patch_inputs__"

    existing = kwargs.get(into, None)
    if existing == None:
        existing = []

    if isinstance(existing, list):
        append_patch_inputs(kwargs, dirs, into = into)
        return

    if not isinstance(existing, dict):
        return

    patch_paths = []
    for d in dirs or []:
        if not isinstance(d, str) or d == "":
            continue
        patch_paths = patch_paths + native.glob(["%s/*.patch" % d])
    patch_paths = dedupe_preserve(sorted(patch_paths))
    kwargs[into] = attach_items_dict_safe(existing, patch_paths, key_prefix)

def append_patch_srcs(kwargs, dirs):
    append_patch_inputs(kwargs, dirs, into = "srcs")

def append_importer_patches(kwargs, importer, lang, into = "srcs"):
    if importer == None or not isinstance(importer, str) or importer == "":
        return
    if lang == None or not isinstance(lang, str) or lang == "":
        return
    base = "patches/%s" % lang
    # Patches live under <importer>/patches/<lang>. If this macro is executing inside that
    # importer package, use the package-relative patch dir to avoid duplicating the path
    # (e.g. apps/demo/apps/demo/...).
    cur_pkg = native.package_name()
    same_pkg = (importer == "." or importer == cur_pkg or (cur_pkg == "" and importer == "."))
    patch_dir = base if same_pkg else ("%s/%s" % (importer, base))
    append_patch_inputs(kwargs, [patch_dir], into = into)

def append_importer_patches_dict_safe(kwargs, importer, lang, into = "srcs", key_prefix = "__patch_inputs__"):
    if importer == None or not isinstance(importer, str) or importer == "":
        return
    if lang == None or not isinstance(lang, str) or lang == "":
        return
    base = "patches/%s" % lang
    cur_pkg = native.package_name()
    same_pkg = (importer == "." or importer == cur_pkg or (cur_pkg == "" and importer == "."))
    patch_dir = base if same_pkg else ("%s/%s" % (importer, base))
    append_patch_inputs_dict_safe(kwargs, [patch_dir], into = into, key_prefix = key_prefix)

def include_importer_patches_from_labels(kwargs, lang, into = "srcs"):
    imp = importer_from_labels(kwargs)
    if imp == None or imp == "":
        return
    append_importer_patches(kwargs, imp, lang, into = into)

def include_importer_patches_from_labels_dict_safe(kwargs, lang, into = "srcs", key_prefix = "__patch_inputs__"):
    imp = importer_from_labels(kwargs)
    if imp == None or imp == "":
        return
    append_importer_patches_dict_safe(kwargs, imp, lang, into = into, key_prefix = key_prefix)

def include_package_local_patches(kwargs, lang, default_dirs = None):
    if not isinstance(lang, str) or lang == "":
        return
    dirs = []
    if isinstance(default_dirs, list) and len(default_dirs) > 0:
        for d in default_dirs:
            if isinstance(d, str) and d != "":
                dirs.append(d)
    if len(dirs) == 0:
        dirs = ["patches/%s" % lang]
    append_patch_srcs(kwargs, dirs)

def default_package_patch_dirs(lang):
    if not isinstance(lang, str) or lang == "":
        return []
    return ["patches/%s" % lang]

def package_local_patches_probe(name, lang, dirs = None):
    kw = {}
    include_package_local_patches(kw, lang, dirs)
    labels_file(
        name = name,
        labels = kw.get("srcs", []) or [],
        out = name + ".srcs.txt",
    )

def patch_inputs_probe(name, dirs, into = "srcs", initial = None):
    kw = {}
    if initial != None:
        kw[into] = initial
    append_patch_inputs(kw, dirs, into = into)
    val = kw.get(into, None)
    items = []
    if isinstance(val, dict):
        items = sorted(val.keys())
    elif isinstance(val, list):
        items = val
    labels_file(
        name = name,
        labels = items,
        out = name + ".items.txt",
    )

def patch_inputs_dict_safe_probe(name, dirs, into = "srcs", initial = None):
    kw = {}
    if initial != None:
        kw[into] = initial
    append_patch_inputs_dict_safe(kw, dirs, into = into)
    val = kw.get(into, None)
    items = []
    if isinstance(val, dict):
        items = sorted(val.keys())
    elif isinstance(val, list):
        items = val
    labels_file(
        name = name,
        labels = items,
        out = name + ".items.txt",
    )


