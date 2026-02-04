load(
    "//build-tools/lang/internal:importer_wiring.bzl",
    "prepare_importer_non_genrule_wiring",
)
load("//build-tools/lang:nix_calling_macros.bzl", "wire_global_nix_inputs")
load("//build-tools/lang:dict_inputs.bzl", "GLOBAL_NIX_INPUTS_KEY_PREFIX", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")

def prepare_importer_non_genrule_nix_calling_wiring(
        name,
        kwargs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        patch_into = "srcs",
        patch_base = None,
        patch_dict_safe = None,
        patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,
        provider_into = "deps",
        provider_base = None,
        provider_dict_safe = None,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,
        MODULE_PROVIDERS = None,
        global_inputs_into = "srcs",
        global_inputs_stamp = False,
        global_inputs_key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX):
    """
    Like prepare_importer_non_genrule_wiring, but also wires global_nix_inputs() as real action
    inputs for macros that call Nix at runtime.

    Returns a struct:
      - importer
      - kwargs: prepared kwargs dict (includes patch inputs and global inputs)
      - deps: provider edges realized deterministically (when provider_into == "deps")
    """
    wiring = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kwargs,
        deps = deps,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        patch_into = patch_into,
        patch_base = patch_base,
        patch_dict_safe = patch_dict_safe,
        patch_key_prefix = patch_key_prefix,
        provider_into = provider_into,
        provider_base = provider_base,
        provider_dict_safe = provider_dict_safe,
        provider_key_prefix = provider_key_prefix,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    kw = wiring.kwargs
    wire_global_nix_inputs(
        kw,
        into = global_inputs_into,
        stamp = global_inputs_stamp,
        key_prefix = global_inputs_key_prefix,
    )
    return struct(
        importer = wiring.importer,
        kwargs = kw,
        deps = wiring.deps,
    )
