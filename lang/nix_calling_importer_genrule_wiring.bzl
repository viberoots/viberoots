load("//lang:importer_wiring.bzl", "prepare_importer_genrule_kwargs")
load("//lang:lockfile_labels.bzl", "importer_from_labels")
load("//lang:nix_calling_macros.bzl", "wire_global_nix_inputs")
load("//lang:dict_inputs.bzl", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")

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
        workspace_root_env_src = "root//tools/buck:workspace-root.env",
        global_inputs_into = "srcs",
        global_inputs_stamp = True,
        global_inputs_key_prefix = "__global_nix_inputs__"):
    """
    Shared helper for importer-scoped, Nix-calling genrule-style macros.

    This composes:
    - importer-scoped wiring (lockfile label enforcement, label stamping, importer patches, provider edges)
    - optional tools/buck/workspace-root.env injection for dict-shaped `srcs`
    - global Nix inputs as real action inputs (optional label stamping)

    Returns a struct:
      - importer: derived importer string
      - kwargs: prepared kwargs dict ready for genrule(**kwargs)
    """
    kw = {} if kwargs == None else kwargs
    is_dict_srcs = isinstance(srcs, dict)
    if inject_workspace_root_env and is_dict_srcs:
        current = srcs or {}
        if not isinstance(current, dict):
            current = {}
        if "tools/buck/workspace-root.env" not in current:
            current["tools/buck/workspace-root.env"] = workspace_root_env_src
        srcs = current

    prepared = prepare_importer_genrule_kwargs(
        name = name,
        kwargs = kw,
        srcs = srcs,
        deps = deps,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        patch_key_prefix = patch_key_prefix,
        provider_key_prefix = provider_key_prefix,
    )
    importer = importer_from_labels(prepared)

    if global_inputs_into != None:
        wire_global_nix_inputs(
            prepared,
            into = global_inputs_into,
            stamp = global_inputs_stamp,
            key_prefix = global_inputs_key_prefix,
        )

    return struct(
        importer = importer,
        kwargs = prepared,
    )


