load("//lang:global_inputs.bzl", "attach_global_nix_inputs")
load("//lang:label_stamping.bzl", "stamp_global_nix_inputs")
load("//lang:dict_inputs.bzl", "GLOBAL_NIX_INPUTS_KEY_PREFIX")

def wire_global_nix_inputs(kwargs, into = "srcs", stamp = True, key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX):
    """
    Apply the centralized "global Nix inputs" policy for macros that call Nix.

    - Attaches global_nix_inputs() as real action inputs (list/dict shapes supported).
    - Optionally stamps global_nix_inputs() into labels for observability.
    """
    if kwargs == None or not isinstance(kwargs, dict):
        return
    attach_global_nix_inputs(kwargs, into = into, key_prefix = key_prefix)
    if stamp:
        stamp_global_nix_inputs(kwargs)



