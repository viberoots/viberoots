NIX_BUILDER_LOCAL_ONLY = "local_only"
NIX_BUILDER_INHERIT_CONFIG = "inherit_config"
NIX_BUILDER_FORCE_BUILDERS_FILE = "force_builders_file"

def nix_builder_policy_args(policy):
    if policy == NIX_BUILDER_LOCAL_ONLY:
        return '--builders ""'
    if policy == NIX_BUILDER_INHERIT_CONFIG:
        return ""
    if policy == NIX_BUILDER_FORCE_BUILDERS_FILE:
        return '--builders "@${VBR_NIX_BUILDERS_FILE:?force_builders_file requires VBR_NIX_BUILDERS_FILE}"'
    fail("unknown Nix builder policy: %s" % policy)
