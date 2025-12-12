load("//lang:collections.bzl", "dedupe_preserve")
load("//lang:label_stamping.bzl", "labels_file")
load("//lang:lockfile_labels.bzl", "importer_from_labels")

def append_patch_srcs(kwargs, dirs):
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
    if importer == None or not isinstance(importer, str) or importer == "":
        return
    if lang == None or not isinstance(lang, str) or lang == "":
        return
    base = "patches/%s" % lang
    patch_dir = base if importer == "." else ("%s/%s" % (importer, base))
    append_patch_srcs(kwargs, [patch_dir])

def include_importer_patches_from_labels(kwargs, lang):
    imp = importer_from_labels(kwargs)
    if imp == None or imp == "":
        return
    append_importer_patches(kwargs, imp, lang)

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


