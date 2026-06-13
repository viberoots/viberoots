load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "default_lockfile_label_from_package",
    "default_lockfile_path_from_package",
    "ensure_default_lockfile_exists",
    "extract_lockfile_labels",
)

def apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package(lang = "python")
        ensure_default_lockfile_exists(default_path, macro_name, lang = "python")
        return default_lockfile_label_from_package(lang = "python")
    return lockfile_label

__all__ = [
    "apply_default_lockfile_label",
]
