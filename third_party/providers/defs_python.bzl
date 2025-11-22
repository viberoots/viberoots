def python_importer_deps(name, lockfile, importer, patch_paths = []):
    # Metadata-only stamp (mirrors Node): avoid cross-package srcs to respect Buck package boundaries.
    # Invalidation for patches is handled by macros that include importer-local patch files in target srcs.
    genrule(
        name = name,
        srcs = [],
        out = name + ".stamp",
        cmd = "echo python_importer:${importer} ${lockfile} > $OUT",
        labels = ["lang:python"],
        visibility = ["PUBLIC"],
    )


