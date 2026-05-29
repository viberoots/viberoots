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
        "build-tools/tools/dev/source-snapshot.ts",
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
        cmd_args(
            args,
            hidden = ctx.attrs.srcs + [
                ctx.attrs.graph,
                ctx.attrs._dev_runtime[DefaultInfo].default_outputs,
                ctx.attrs._lib_runtime[DefaultInfo].default_outputs,
            ],
        ),
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
        "_dev_runtime": attrs.dep(default = "//build-tools/tools/dev:runtime_ts"),
        "_lib_runtime": attrs.dep(default = "//build-tools/tools/lib:runtime_ts"),
    },
)

def source_snapshot(name, srcs = [], graph = "//build-tools/tools/buck:graph.json"):
    _source_snapshot(
        name = name,
        srcs = srcs,
        graph = graph,
    )
