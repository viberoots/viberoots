load("//build-tools/lang:collections.bzl", "dedupe_preserve")
load("//build-tools/lang:dict_inputs.bzl", "GLOBAL_NIX_INPUTS_KEY_PREFIX", "attach_items_dict_safe")

def global_nix_inputs():
    """
    Centralized global Nix inputs stamping policy (PR‑5).
    Prefer builder/Nix-level consideration; when macro-level stamping is justified,
    consume this helper instead of hardcoding labels in macros.
    """
    # Current policy: include repo-level flake.lock as a single global input.
    # This keeps behavior consistent across languages and avoids ad-hoc stamping.
    return ["//:flake.lock"]


def attach_global_nix_inputs(kwargs, into = "srcs", key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX):
    """
    Attach global_nix_inputs() as real action inputs.

    - Supports list-shaped and dict-shaped input attributes.
    - For dict-shaped inputs, creates deterministic synthetic keys under key_prefix.
    - Call-sites must not hardcode //:flake.lock; they should call this helper.
    """
    if kwargs == None or not isinstance(kwargs, dict):
        return
    if not isinstance(into, str) or into == "":
        return
    if not isinstance(key_prefix, str) or key_prefix == "":
        key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX

    existing = kwargs.get(into, None)
    if existing == None:
        existing = []

    inputs = global_nix_inputs()

    if isinstance(existing, list):
        kwargs[into] = dedupe_preserve(existing + inputs)
        return

    if isinstance(existing, dict):
        kwargs[into] = attach_items_dict_safe(existing, inputs, key_prefix)
        return

    # Unknown shape; leave untouched.

