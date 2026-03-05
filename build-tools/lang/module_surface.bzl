ModuleSurfaceInfo = provider(fields = [
    "module_kind",
    "source_roots",
    "artifact_mapping_policy",
    "watch_hints",
])

def _module_surface_impl(ctx):
    out = ctx.actions.declare_output(ctx.label.name + ".surface")
    rows = [
        "module_surface",
        "module_kind=%s" % ctx.attrs.module_kind,
        "artifact_mapping_policy=%s" % ctx.attrs.artifact_mapping_policy,
        "source_roots=%s" % ",".join(ctx.attrs.source_roots),
        "watch_hints=%s" % ",".join(ctx.attrs.watch_hints),
        "",
    ]
    ctx.actions.write(out, "\n".join(rows))
    return [
        DefaultInfo(default_output = out),
        ModuleSurfaceInfo(
            module_kind = ctx.attrs.module_kind,
            source_roots = ctx.attrs.source_roots,
            artifact_mapping_policy = ctx.attrs.artifact_mapping_policy,
            watch_hints = ctx.attrs.watch_hints,
        ),
    ]

module_surface = rule(
    impl = _module_surface_impl,
    attrs = {
        "module_kind": attrs.string(),
        "source_roots": attrs.list(attrs.string(), default = []),
        "artifact_mapping_policy": attrs.string(default = ""),
        "watch_hints": attrs.list(attrs.string(), default = []),
    },
)
