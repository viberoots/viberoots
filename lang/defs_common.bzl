load("//lang:collections.bzl", _dedupe_preserve = "dedupe_preserve")
load("//lang:label_stamping.bzl", _normalize_labels = "normalize_labels", _stamp_global_nix_inputs = "stamp_global_nix_inputs", _stamp_labels = "stamp_labels", _stamp_wasm_variant = "stamp_wasm_variant", _wasm_labels_probe = "wasm_labels_probe")
load(
    "//lang:lockfile_labels.bzl",
    _default_lockfile_label_from_package = "default_lockfile_label_from_package",
    _default_lockfile_path_from_package = "default_lockfile_path_from_package",
    _ensure_default_lockfile_exists = "ensure_default_lockfile_exists",
    _ensure_single_lockfile_label = "ensure_single_lockfile_label",
    _extract_lockfile_labels = "extract_lockfile_labels",
    _importer_from_labels = "importer_from_labels",
    _importer_from_labels_probe = "importer_from_labels_probe",
    _lockfile_label_parse_probe = "lockfile_label_parse_probe",
    _supported_importer_label_probe = "supported_importer_label_probe",
)
load("//lang:nixpkg_labels.bzl", _append_nixpkg_labels = "append_nixpkg_labels", _normalize_nix_attr = "normalize_nix_attr", _normalize_nix_attr_probe = "normalize_nix_attr_probe")
load(
    "//lang:macro_kwargs.bzl",
    _macro_kwargs_probe = "macro_kwargs_probe",
    _extract_package_local_patch_dirs_and_nixpkg_deps = "extract_package_local_patch_dirs_and_nixpkg_deps",
    _pop_local_patch_dirs = "pop_local_patch_dirs",
    _pop_nixpkg_deps = "pop_nixpkg_deps",
    _pop_package_local_patch_dirs_and_nixpkg_deps = "pop_package_local_patch_dirs_and_nixpkg_deps",
)
load(
    "//lang:patch_inputs.bzl",
    _append_importer_patches = "append_importer_patches",
    _append_patch_inputs = "append_patch_inputs",
    _append_patch_inputs_dict_safe = "append_patch_inputs_dict_safe",
    _append_patch_srcs = "append_patch_srcs",
    _append_importer_patches_dict_safe = "append_importer_patches_dict_safe",
    _default_package_patch_dirs = "default_package_patch_dirs",
    _include_importer_patches_from_labels = "include_importer_patches_from_labels",
    _include_importer_patches_from_labels_dict_safe = "include_importer_patches_from_labels_dict_safe",
    _include_package_local_patches = "include_package_local_patches",
    _package_local_patches_probe = "package_local_patches_probe",
    _patch_inputs_dict_safe_probe = "patch_inputs_dict_safe_probe",
    _patch_inputs_probe = "patch_inputs_probe",
    _synthetic_dep_for_importer_patches_from_labels = "synthetic_dep_for_importer_patches_from_labels",
    _synthetic_dep_for_importer_patches_from_labels_probe = "synthetic_dep_for_importer_patches_from_labels_probe",
)
load(
    "//lang:provider_edges.bzl",
    _merge_provider_edges_dict_safe_probe = "merge_provider_edges_dict_safe_probe",
    _merge_provider_edges_list_probe = "merge_provider_edges_list_probe",
    _merge_provider_edges = "merge_provider_edges",
    _providers_for = "providers_for",
    _realize_provider_edges = "realize_provider_edges",
    _realize_provider_edges_probe = "realize_provider_edges_probe",
    _strip_provider_targets = "strip_provider_targets",
    _strip_provider_targets_probe = "strip_provider_targets_probe",
    _target_key_for_current_package = "target_key_for_current_package",
)
load(
    "//lang:dict_inputs.bzl",
    _GLOBAL_NIX_INPUTS_KEY_PREFIX = "GLOBAL_NIX_INPUTS_KEY_PREFIX",
    _PATCH_INPUTS_KEY_PREFIX = "PATCH_INPUTS_KEY_PREFIX",
    _PROVIDER_EDGES_KEY_PREFIX = "PROVIDER_EDGES_KEY_PREFIX",
    _attach_items_dict_safe = "attach_items_dict_safe",
    _dict_items_probe = "dict_items_probe",
)
load(
    "//lang:language_wiring.bzl",
    _prepare_language_wiring = "prepare_language_wiring",
)
load(
    "//lang:language_wiring_probe.bzl",
    _language_wiring_mutation_probe = "language_wiring_mutation_probe",
)
load("//lang:nix_calling_macros.bzl", _wire_global_nix_inputs = "wire_global_nix_inputs")
load(
    "//lang:kind_vocabulary.bzl",
    _allowed_kind_values = "ALLOWED_KIND_VALUES",
    _is_allowed_kind_value = "is_allowed_kind_value",
    _kind_vocabulary_probe = "kind_vocabulary_probe",
)
load(
    "//lang:planner_visible_wiring.bzl",
    _wire_planner_visible_inputs = "wire_planner_visible_inputs",
    _wire_planner_visible_stub = "wire_planner_visible_stub",
    _wire_package_local_planner_visible_stub = "wire_package_local_planner_visible_stub",
)
load(
    "//lang:wasm_package_local_wiring.bzl",
    _prepare_package_local_wasm_wiring = "prepare_package_local_wasm_wiring",
    _package_local_wasm_wiring_mutation_probe = "package_local_wasm_wiring_mutation_probe",
    _wire_package_local_wasm_planner_visible_stub = "wire_package_local_wasm_planner_visible_stub",
)
load(
    "//lang:link_intent.bzl",
    _merge_link_intent_deps = "merge_link_intent_deps",
    _validate_link_closure_overrides = "validate_link_closure_overrides",
)

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
lockfile_label_parse_probe = _lockfile_label_parse_probe
supported_importer_label_probe = _supported_importer_label_probe
default_lockfile_label_from_package = _default_lockfile_label_from_package
default_lockfile_path_from_package = _default_lockfile_path_from_package
ensure_default_lockfile_exists = _ensure_default_lockfile_exists

append_patch_srcs = _append_patch_srcs
append_patch_inputs = _append_patch_inputs
append_patch_inputs_dict_safe = _append_patch_inputs_dict_safe
append_importer_patches = _append_importer_patches
append_importer_patches_dict_safe = _append_importer_patches_dict_safe
include_importer_patches_from_labels = _include_importer_patches_from_labels
include_importer_patches_from_labels_dict_safe = _include_importer_patches_from_labels_dict_safe
include_package_local_patches = _include_package_local_patches
default_package_patch_dirs = _default_package_patch_dirs
package_local_patches_probe = _package_local_patches_probe
patch_inputs_probe = _patch_inputs_probe
patch_inputs_dict_safe_probe = _patch_inputs_dict_safe_probe
synthetic_dep_for_importer_patches_from_labels = _synthetic_dep_for_importer_patches_from_labels
synthetic_dep_for_importer_patches_from_labels_probe = _synthetic_dep_for_importer_patches_from_labels_probe

normalize_nix_attr = _normalize_nix_attr
append_nixpkg_labels = _append_nixpkg_labels
normalize_nix_attr_probe = _normalize_nix_attr_probe

pop_local_patch_dirs = _pop_local_patch_dirs
pop_nixpkg_deps = _pop_nixpkg_deps
pop_package_local_patch_dirs_and_nixpkg_deps = _pop_package_local_patch_dirs_and_nixpkg_deps
extract_package_local_patch_dirs_and_nixpkg_deps = _extract_package_local_patch_dirs_and_nixpkg_deps
macro_kwargs_probe = _macro_kwargs_probe

target_key_for_current_package = _target_key_for_current_package
providers_for = _providers_for
realize_provider_edges = _realize_provider_edges
realize_provider_edges_probe = _realize_provider_edges_probe
merge_provider_edges = _merge_provider_edges
merge_provider_edges_list_probe = _merge_provider_edges_list_probe
merge_provider_edges_dict_safe_probe = _merge_provider_edges_dict_safe_probe
strip_provider_targets = _strip_provider_targets
strip_provider_targets_probe = _strip_provider_targets_probe

attach_items_dict_safe = _attach_items_dict_safe
dict_items_probe = _dict_items_probe
PATCH_INPUTS_KEY_PREFIX = _PATCH_INPUTS_KEY_PREFIX
PROVIDER_EDGES_KEY_PREFIX = _PROVIDER_EDGES_KEY_PREFIX
GLOBAL_NIX_INPUTS_KEY_PREFIX = _GLOBAL_NIX_INPUTS_KEY_PREFIX

wire_global_nix_inputs = _wire_global_nix_inputs

allowed_kind_values = _allowed_kind_values
is_allowed_kind_value = _is_allowed_kind_value
kind_vocabulary_probe = _kind_vocabulary_probe

wire_planner_visible_inputs = _wire_planner_visible_inputs
wire_planner_visible_stub = _wire_planner_visible_stub
wire_package_local_planner_visible_stub = _wire_package_local_planner_visible_stub

# Preferred unified macro wiring helper (non-mutating at the call-site boundary).
prepare_language_wiring = _prepare_language_wiring
language_wiring_mutation_probe = _language_wiring_mutation_probe
#
prepare_package_local_wasm_wiring = _prepare_package_local_wasm_wiring
package_local_wasm_wiring_mutation_probe = _package_local_wasm_wiring_mutation_probe
wire_package_local_wasm_planner_visible_stub = _wire_package_local_wasm_planner_visible_stub

merge_link_intent_deps = _merge_link_intent_deps
validate_link_closure_overrides = _validate_link_closure_overrides

