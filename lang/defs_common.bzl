load("//lang:collections.bzl", _dedupe_preserve = "dedupe_preserve")
load("//lang:label_stamping.bzl", _normalize_labels = "normalize_labels", _stamp_global_nix_inputs = "stamp_global_nix_inputs", _stamp_labels = "stamp_labels", _stamp_wasm_variant = "stamp_wasm_variant", _wasm_labels_probe = "wasm_labels_probe")
load("//lang:lockfile_labels.bzl", _ensure_single_lockfile_label = "ensure_single_lockfile_label", _extract_lockfile_labels = "extract_lockfile_labels", _importer_from_labels = "importer_from_labels", _importer_from_labels_probe = "importer_from_labels_probe")
load("//lang:nixpkg_labels.bzl", _append_nixpkg_labels = "append_nixpkg_labels", _normalize_nix_attr = "normalize_nix_attr", _normalize_nix_attr_probe = "normalize_nix_attr_probe")
load("//lang:patch_inputs.bzl", _append_importer_patches = "append_importer_patches", _append_patch_srcs = "append_patch_srcs", _default_package_patch_dirs = "default_package_patch_dirs", _include_importer_patches_from_labels = "include_importer_patches_from_labels", _include_package_local_patches = "include_package_local_patches", _package_local_patches_probe = "package_local_patches_probe")
load("//lang:provider_edges.bzl", _providers_for = "providers_for", _realize_provider_edges = "realize_provider_edges", _realize_provider_edges_probe = "realize_provider_edges_probe", _target_key_for_current_package = "target_key_for_current_package")

dedupe_preserve = _dedupe_preserve

normalize_labels = _normalize_labels
stamp_labels = _stamp_labels
stamp_global_nix_inputs = _stamp_global_nix_inputs
stamp_wasm_variant = _stamp_wasm_variant
wasm_labels_probe = _wasm_labels_probe

extract_lockfile_labels = _extract_lockfile_labels
ensure_single_lockfile_label = _ensure_single_lockfile_label
importer_from_labels = _importer_from_labels
importer_from_labels_probe = _importer_from_labels_probe

append_patch_srcs = _append_patch_srcs
append_importer_patches = _append_importer_patches
include_importer_patches_from_labels = _include_importer_patches_from_labels
include_package_local_patches = _include_package_local_patches
default_package_patch_dirs = _default_package_patch_dirs
package_local_patches_probe = _package_local_patches_probe

normalize_nix_attr = _normalize_nix_attr
append_nixpkg_labels = _append_nixpkg_labels
normalize_nix_attr_probe = _normalize_nix_attr_probe

target_key_for_current_package = _target_key_for_current_package
providers_for = _providers_for
realize_provider_edges = _realize_provider_edges
realize_provider_edges_probe = _realize_provider_edges_probe

