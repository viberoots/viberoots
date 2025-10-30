load("@prelude//:rules.bzl", "genrule")

def node_importer_deps(name, lockfile, importer, patch_paths = []):
    # Node importer providers are metadata-only. Buck packages cannot reference
    # files outside their package as srcs, so we avoid adding lockfiles or patch
    # paths here. The presence of this target realizes the dependency edge; the
    # stamp content is deterministic and includes the importer key for debugging.
    genrule(
        name = name,
        srcs = [],
        out = name + ".stamp",
        cmd = "echo node_importer:${importer} ${lockfile} > $OUT",
        visibility = ["PUBLIC"],
    )



