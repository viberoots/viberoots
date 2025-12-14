load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:label_stamping.bzl", "labels_file")
load("//lang:lockfile_labels.bzl", "importer_from_labels")

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

def include_importer_patches_from_labels(kwargs, lang, into = "srcs"):
    imp = importer_from_labels(kwargs)
    if imp == None or imp == "":
        return
    append_importer_patches(kwargs, imp, lang, into = into)

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


