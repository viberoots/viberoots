load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "ensure_single_lockfile_label",
    "extract_lockfile_labels",
    "include_importer_patches_from_labels",
)
load("@viberoots//build-tools/python:defs_lockfile.bzl", "apply_default_lockfile_label")

_ADDON_FIRST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_"
_ADDON_REST = _ADDON_FIRST + "0123456789-"
SUPPORTED_NODE_API_VERSIONS = [8, 9, 10]
_EXTENSION_FIELD_OWNERS = {
    "addon_name": "addon",
    "build_py_deps": "pyext",
    "module": "pyext",
    "node_api_version": "addon",
    "platform": "addon",
    "python_abi": "pyext",
}

def validate_addon_name(value):
    if not isinstance(value, str) or value == "":
        fail("rust_node_addon: addon_name must be a non-empty stable artifact stem")
    if value[0] not in _ADDON_FIRST or not all([char in _ADDON_REST for char in value.elems()]):
        fail("rust_node_addon: addon_name must match [A-Za-z_][A-Za-z0-9_-]*")
    return value

def validate_node_api_version(value):
    if value not in SUPPORTED_NODE_API_VERSIONS:
        fail("rust_node_addon: node_api_version must be one of %s for the selected Node toolchain" % SUPPORTED_NODE_API_VERSIONS)
    return value

def validate_extension_kind_args(kind, kwargs):
    for field in sorted(_EXTENSION_FIELD_OWNERS.keys()):
        owner = _EXTENSION_FIELD_OWNERS[field]
        if field in kwargs and kind != owner:
            fail("%s: %s is only supported by %s" % (
                "rust_node_addon" if kind == "addon" else "rust_python_extension" if kind == "pyext" else "rust target kind " + kind,
                field,
                "rust_node_addon" if owner == "addon" else "rust_python_extension",
            ))

def prepare_python_build_wiring(kwargs, lockfile_label, build_py_deps):
    kw = dict(kwargs)
    labels = list(kw.get("labels", []) or [])
    if not build_py_deps and lockfile_label == None and not extract_lockfile_labels(labels):
        return kw
    resolved = apply_default_lockfile_label(
        lockfile_label,
        labels,
        "rust_python_extension",
    )
    lock_kw = {
        "labels": labels,
        "srcs": list(kw.get("srcs", []) or []),
    }
    ensure_single_lockfile_label(lock_kw, resolved)
    include_importer_patches_from_labels(lock_kw, "python", into = "srcs")
    kw["labels"] = lock_kw["labels"]
    kw["srcs"] = lock_kw["srcs"]
    return kw

__all__ = [
    "SUPPORTED_NODE_API_VERSIONS",
    "prepare_python_build_wiring",
    "validate_addon_name",
    "validate_extension_kind_args",
    "validate_node_api_version",
]
