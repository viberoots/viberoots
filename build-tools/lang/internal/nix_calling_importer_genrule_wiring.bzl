load("@viberoots//build-tools/lang:lockfile_labels.bzl", "importer_from_labels")
load("@viberoots//build-tools/lang:nix_calling_macros.bzl", "wire_global_nix_inputs")
load("@viberoots//build-tools/lang:dict_inputs.bzl", "GLOBAL_NIX_INPUTS_KEY_PREFIX", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")
load("@viberoots//build-tools/lang/internal:importer_wiring.bzl", "prepare_importer_genrule_kwargs")

def _clone_container_or_none(v):
    if isinstance(v, dict):
        return dict(v)
    if isinstance(v, list):
        return list(v)
    return v

def prepare_importer_nix_calling_genrule_wiring(
        name,
        kwargs,
        srcs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None,
        patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,
        inject_workspace_root_env = False,
        workspace_root_env_src = "workspace_buck//:workspace-root.env",
        global_inputs_into = "srcs",
        global_inputs_stamp = True,
        global_inputs_key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX):
    """
    Shared helper for importer-scoped, Nix-calling genrule-style macros.

    This composes:
    - importer-scoped wiring (lockfile label enforcement, label stamping, importer patches, provider edges)
    - optional build-tools/tools/buck/workspace-root.env injection for dict-shaped `srcs`
    - global Nix inputs as real action inputs (optional label stamping)
    """
    kw = dict(kwargs) if kwargs != None else {}
    existing_labels = kw.get("labels", []) or []
    kw["labels"] = list(existing_labels) if isinstance(existing_labels, list) else []
    srcs2 = _clone_container_or_none(srcs)
    deps2 = list(deps) if isinstance(deps, list) else []

    is_dict_srcs = isinstance(srcs2, dict)
    if inject_workspace_root_env and is_dict_srcs:
        current = srcs2 or {}
        if not isinstance(current, dict):
            current = {}
        if "build-tools/tools/buck/workspace-root.env" not in current:
            current["build-tools/tools/buck/workspace-root.env"] = workspace_root_env_src
        srcs2 = current

    prepared = prepare_importer_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = srcs2,
        deps = deps2,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        patch_key_prefix = patch_key_prefix,
        provider_key_prefix = provider_key_prefix,
    )
    prepared_kw = prepared.kwargs
    importer = importer_from_labels(prepared_kw)

    if global_inputs_into != None:
        wire_global_nix_inputs(
            prepared_kw,
            into = global_inputs_into,
            stamp = global_inputs_stamp,
            key_prefix = global_inputs_key_prefix,
        )

    return struct(
        importer = importer,
        kwargs = prepared_kw,
    )
