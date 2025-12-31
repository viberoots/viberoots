load("//lang:collections.bzl", _dedupe_preserve = "dedupe_preserve")
load("//lang:label_stamping.bzl", _normalize_labels = "normalize_labels", _stamp_global_nix_inputs = "stamp_global_nix_inputs", _stamp_labels = "stamp_labels", _stamp_wasm_variant = "stamp_wasm_variant", _wasm_labels_probe = "wasm_labels_probe")
load(
    "//lang:lockfile_labels.bzl",
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
    "//lang:importer_wiring.bzl",
    _attach_importer_patch_inputs = "attach_importer_patch_inputs",
    _merge_provider_edges = "merge_provider_edges",
    _prepare_importer_genrule_kwargs = "prepare_importer_genrule_kwargs",
    _prepare_importer_non_genrule_wiring = "prepare_importer_non_genrule_wiring",
    _prepare_importer_srcsless_rule_wiring = "prepare_importer_srcsless_rule_wiring",
    _require_single_importer_lockfile_label = "require_single_importer_lockfile_label",
)
load(
    "//lang:importer_wiring_v2.bzl",
    _importer_wiring_v2_mutation_probe = "importer_wiring_v2_mutation_probe",
    _prepare_importer_genrule_kwargs_v2 = "prepare_importer_genrule_kwargs_v2",
    _prepare_importer_non_genrule_wiring_v2 = "prepare_importer_non_genrule_wiring_v2",
    _prepare_importer_srcsless_rule_wiring_v2 = "prepare_importer_srcsless_rule_wiring_v2",
)
load(
    "//lang:importer_wiring_v2_nix_calling.bzl",
    _prepare_importer_non_genrule_nix_calling_wiring_v2 = "prepare_importer_non_genrule_nix_calling_wiring_v2",
)
load(
    "//lang:nix_calling_importer_genrule_wiring.bzl",
    _prepare_importer_nix_calling_genrule_wiring = "prepare_importer_nix_calling_genrule_wiring",
    _prepare_importer_nix_calling_genrule_wiring_v2 = "prepare_importer_nix_calling_genrule_wiring_v2",
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
    _wire_package_local_planner_visible_stub_v2 = "wire_package_local_planner_visible_stub_v2",
)
load(
    "//lang:package_local_wiring.bzl",
    _prepare_package_local_wiring = "prepare_package_local_wiring",
    _prepare_package_local_wiring_v2 = "prepare_package_local_wiring_v2",
    _package_local_wiring_probe = "package_local_wiring_probe",
    _package_local_wiring_v2_mutation_probe = "package_local_wiring_v2_mutation_probe",
)
load(
    "//lang:wasm_package_local_wiring.bzl",
    _prepare_package_local_wasm_wiring = "prepare_package_local_wasm_wiring",
    _wire_package_local_wasm_planner_visible_stub = "wire_package_local_wasm_planner_visible_stub",
    _wire_package_local_wasm_planner_visible_stub_v2 = "wire_package_local_wasm_planner_visible_stub_v2",
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
strip_provider_targets = _strip_provider_targets
strip_provider_targets_probe = _strip_provider_targets_probe

attach_items_dict_safe = _attach_items_dict_safe
dict_items_probe = _dict_items_probe
PATCH_INPUTS_KEY_PREFIX = _PATCH_INPUTS_KEY_PREFIX
PROVIDER_EDGES_KEY_PREFIX = _PROVIDER_EDGES_KEY_PREFIX
GLOBAL_NIX_INPUTS_KEY_PREFIX = _GLOBAL_NIX_INPUTS_KEY_PREFIX

require_single_importer_lockfile_label = _require_single_importer_lockfile_label
attach_importer_patch_inputs = _attach_importer_patch_inputs
merge_provider_edges = _merge_provider_edges

# Preferred importer-scoped macro wiring helpers (v2, non-mutating at the call-site boundary).
prepare_importer_genrule_kwargs_v2 = _prepare_importer_genrule_kwargs_v2
prepare_importer_non_genrule_nix_calling_wiring_v2 = _prepare_importer_non_genrule_nix_calling_wiring_v2
prepare_importer_non_genrule_wiring_v2 = _prepare_importer_non_genrule_wiring_v2
prepare_importer_srcsless_rule_wiring_v2 = _prepare_importer_srcsless_rule_wiring_v2
importer_wiring_v2_mutation_probe = _importer_wiring_v2_mutation_probe

prepare_importer_nix_calling_genrule_wiring = _prepare_importer_nix_calling_genrule_wiring
prepare_importer_nix_calling_genrule_wiring_v2 = _prepare_importer_nix_calling_genrule_wiring_v2

# Legacy importer-scoped macro wiring helpers (v1, mutating). Keep exported for migration only.
prepare_importer_genrule_kwargs = _prepare_importer_genrule_kwargs
prepare_importer_non_genrule_wiring = _prepare_importer_non_genrule_wiring
prepare_importer_srcsless_rule_wiring = _prepare_importer_srcsless_rule_wiring

wire_global_nix_inputs = _wire_global_nix_inputs

allowed_kind_values = _allowed_kind_values
is_allowed_kind_value = _is_allowed_kind_value
kind_vocabulary_probe = _kind_vocabulary_probe

wire_planner_visible_inputs = _wire_planner_visible_inputs
wire_planner_visible_stub = _wire_planner_visible_stub
wire_package_local_planner_visible_stub_v2 = _wire_package_local_planner_visible_stub_v2

# Legacy planner-visible stub helper (v1, mutating). Keep exported for migration only.
wire_package_local_planner_visible_stub = _wire_package_local_planner_visible_stub

# Preferred package-local macro wiring helper (v2, non-mutating at the call-site boundary).
prepare_package_local_wiring_v2 = _prepare_package_local_wiring_v2
package_local_wiring_probe = _package_local_wiring_probe
package_local_wiring_v2_mutation_probe = _package_local_wiring_v2_mutation_probe

# Legacy package-local macro wiring helper (v1, mutating). Keep exported for migration only.
prepare_package_local_wiring = _prepare_package_local_wiring

prepare_package_local_wasm_wiring = _prepare_package_local_wasm_wiring
wire_package_local_wasm_planner_visible_stub_v2 = _wire_package_local_wasm_planner_visible_stub_v2

# Legacy package-local WASM planner-visible stub wrapper (keep exported; must not be used in new macros).
wire_package_local_wasm_planner_visible_stub = _wire_package_local_wasm_planner_visible_stub

