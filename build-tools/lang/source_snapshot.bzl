SourceSnapshotInfo = provider(fields = [
    "snapshot",
    "manifest",
    "graph",
])

def _source_snapshot_impl(ctx):
    snapshot = ctx.actions.declare_output(ctx.attrs.name + ".source-snapshot", dir = True)
    manifest = ctx.actions.declare_output(ctx.attrs.name + ".source-snapshot.manifest.json")
    args = [
        "node",
        "--experimental-strip-types",
        ctx.attrs._tool,
        "--out",
        snapshot.as_output(),
        "--manifest",
        manifest.as_output(),
        "--graph",
        ctx.attrs.graph,
        "--declared-root",
        snapshot.as_output(),
        "--declared-graph",
        ctx.attrs.graph,
    ]
    for src in ctx.attrs.srcs:
        args.extend(["--file", src.short_path, src])
    ctx.actions.run(
        cmd_args(args, hidden = ctx.attrs.srcs + [ctx.attrs.graph, ctx.attrs._tool]),
        category = "source_snapshot",
    )
    return [
        DefaultInfo(default_output = snapshot, other_outputs = [manifest]),
        SourceSnapshotInfo(snapshot = snapshot, manifest = manifest, graph = ctx.attrs.graph),
    ]

_source_snapshot = rule(
    impl = _source_snapshot_impl,
    attrs = {
        "srcs": attrs.list(attrs.source(), default = []),
        "graph": attrs.source(default = "//build-tools/tools/buck:graph.json"),
        "_tool": attrs.source(default = "//build-tools/tools/dev:source-snapshot.ts"),
    },
)

def source_snapshot(name, srcs = [], graph = "//build-tools/tools/buck:graph.json"):
    _source_snapshot(
        name = name,
        srcs = srcs,
        graph = graph,
    )
