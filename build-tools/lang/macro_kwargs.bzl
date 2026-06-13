load("@viberoots//build-tools/lang:labels_file.bzl", "labels_file")
load("@viberoots//build-tools/lang:patch_inputs.bzl", "default_package_patch_dirs")
load("@viberoots//build-tools/lang:nixpkg_labels.bzl", "append_nixpkg_labels")

def pop_local_patch_dirs(kwargs, lang):
    """
    Pop `local_patch_dirs` from `kwargs` and return a list of patch directories.

    Behavior is tolerant and deterministic:
    - If the caller provides a list, it is returned as-is.
    - Any non-list shape is ignored and the language default is returned.
    """
    default_dirs = default_package_patch_dirs(lang)
    raw = kwargs.pop("local_patch_dirs", default_dirs)
    if isinstance(raw, list):
        return raw
    return default_dirs

def pop_nixpkg_deps(kwargs):
    """
    Pop `nixpkg_deps` from `kwargs` and return a list of strings.

    Behavior is tolerant and deterministic:
    - If the caller provides a list, it is returned as-is (individual items are validated later).
    - Any non-list shape is ignored and treated as empty.
    """
    raw = kwargs.pop("nixpkg_deps", [])
    if isinstance(raw, list):
        return raw
    return []

def pop_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True):
    """
    Shared macro helper:
    - pops `local_patch_dirs` (default: `default_package_patch_dirs(lang)`)
    - pops `nixpkg_deps` (list-of-strings or empty; non-list ignored deterministically)
    - optionally appends normalized `nixpkg:` labels via `append_nixpkg_labels(...)`

    Returns a struct: { local_patch_dirs, nixpkg_deps }.
    """
    local_patch_dirs = pop_local_patch_dirs(kwargs, lang)
    nixpkg_deps = pop_nixpkg_deps(kwargs)
    if append_labels:
        append_nixpkg_labels(kwargs, nixpkg_deps)
    return struct(
        local_patch_dirs = local_patch_dirs,
        nixpkg_deps = nixpkg_deps,
    )

def extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True):
    """
    Non-mutating variant of pop_package_local_patch_dirs_and_nixpkg_deps.

    Returns a struct:
      - kwargs: a new dict with `local_patch_dirs` / `nixpkg_deps` removed (and labels appended if enabled)
      - local_patch_dirs
      - nixpkg_deps
    """
    src = kwargs if isinstance(kwargs, dict) else {}
    kw = dict(src)
    info = pop_package_local_patch_dirs_and_nixpkg_deps(kw, lang, append_labels = append_labels)
    return struct(
        kwargs = kw,
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
    )

def macro_kwargs_probe(name, lang, local_patch_dirs = None, nixpkg_deps = None, append_labels = True):
    """
    Probe helper for tests. Writes a newline-delimited file of:
    - patch_dir:<dir> (in returned order)
    - nixpkg_dep:<raw> (in returned order)
    - label:<label> (post-append_nixpkg_labels, if enabled)
    """
    kw = {}
    if local_patch_dirs != None:
        kw["local_patch_dirs"] = local_patch_dirs
    if nixpkg_deps != None:
        kw["nixpkg_deps"] = nixpkg_deps
    info = pop_package_local_patch_dirs_and_nixpkg_deps(kw, lang, append_labels = append_labels)
    out = []
    for d in info.local_patch_dirs:
        out.append("patch_dir:%s" % d)
    for a in info.nixpkg_deps:
        out.append("nixpkg_dep:%s" % a)
    if append_labels:
        for l in (kw.get("labels", []) or []):
            out.append("label:%s" % l)
    labels_file(
        name = name,
        labels = out,
        out = name + ".items.txt",
    )

__all__ = [
    "pop_local_patch_dirs",
    "pop_nixpkg_deps",
    "pop_package_local_patch_dirs_and_nixpkg_deps",
    "extract_package_local_patch_dirs_and_nixpkg_deps",
    "macro_kwargs_probe",
]


