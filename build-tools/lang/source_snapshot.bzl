load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")
load("@repo_toolchains//:toolchain_paths.bzl", "NIX_ZX_WRAPPER_BIN")

SourceSnapshotInfo = provider(fields = [
    "snapshot",
    "manifest",
    "graph",
])

def _source_snapshot_impl(ctx):
    snapshot = ctx.actions.declare_output(ctx.attrs.name + ".source-snapshot", dir = True)
    manifest = ctx.actions.declare_output(ctx.attrs.name + ".source-snapshot.manifest.json")
    args = [
        ctx.attrs._runner[RunInfo],
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
    run_nix_action(
        ctx,
        cmd_args(
            args,
            hidden = [
                ctx.attrs._runner[DefaultInfo].default_outputs,
            ] + ctx.attrs.srcs + [
                ctx.attrs.graph,
            ],
        ),
        "source_snapshot",
        mode = "local-only",
    )
    return [
        DefaultInfo(default_output = snapshot, other_outputs = [manifest]),
        SourceSnapshotInfo(snapshot = snapshot, manifest = manifest, graph = ctx.attrs.graph),
    ]

_source_snapshot = rule(
    impl = _source_snapshot_impl,
    attrs = {
        "srcs": attrs.list(attrs.source(), default = []),
        "graph": attrs.source(default = "workspace_buck//:graph.json"),
        "_runner": attrs.dep(
            default = "@viberoots//build-tools/tools/dev:source-snapshot-runner",
            providers = [RunInfo],
        ),
    },
)

def _require_nix_bin(bin_path, label):
    if not bin_path or not bin_path.startswith("/nix/store/"):
        fail("{} must be a /nix/store path (got: {}). Run build-tools/tools/dev/gen-toolchain-paths.ts or i.".format(label, bin_path))

def _source_snapshot_runner_impl(ctx):
    zx_wrapper_tool = ctx.attrs.zx_wrapper_tool[DefaultInfo].default_outputs
    return [
        DefaultInfo(
            default_output = ctx.attrs.generator,
            other_outputs = [ctx.attrs.zx_init] + zx_wrapper_tool,
        ),
        RunInfo(args = cmd_args(
            ctx.attrs.zx_wrapper_tool[RunInfo],
            "--import",
            cmd_args(ctx.attrs.zx_init, format = "./{}"),
            cmd_args(ctx.attrs.generator, format = "./{}"),
            hidden = [
                ctx.attrs.generator,
                ctx.attrs.zx_init,
                ctx.attrs.dev_runtime[DefaultInfo].default_outputs,
                ctx.attrs.lib_runtime[DefaultInfo].default_outputs,
                zx_wrapper_tool,
            ],
        )),
    ]

source_snapshot_runner = rule(
    impl = _source_snapshot_runner_impl,
    attrs = {
        "dev_runtime": attrs.dep(default = "@viberoots//build-tools/tools/dev:runtime_ts"),
        "generator": attrs.source(default = "@viberoots//build-tools/tools/dev:source-snapshot.ts"),
        "lib_runtime": attrs.dep(default = "@viberoots//build-tools/tools/lib:runtime_ts"),
        "zx_init": attrs.source(default = "@viberoots//build-tools/tools/dev:zx-init.mjs"),
        "zx_wrapper_tool": attrs.dep(
            default = "@viberoots//build-tools/tools/dev:source-snapshot-zx-wrapper",
            providers = [RunInfo],
        ),
    },
)

def _source_snapshot_zx_wrapper_tool_impl(ctx):
    _require_nix_bin(ctx.attrs.zx_wrapper, "NIX_ZX_WRAPPER_BIN")
    out = ctx.actions.write(
        ctx.attrs.name,
        "#!/bin/sh\nexec %s \"$@\"\n" % ctx.attrs.zx_wrapper,
        is_executable = True,
    )
    return [
        DefaultInfo(default_output = out),
        RunInfo(args = cmd_args(out)),
    ]

source_snapshot_zx_wrapper_tool = rule(
    impl = _source_snapshot_zx_wrapper_tool_impl,
    attrs = {
        "zx_wrapper": attrs.string(default = NIX_ZX_WRAPPER_BIN),
    },
)

def source_snapshot(name, srcs = [], graph = "workspace_buck//:graph.json"):
    if len(srcs) == 0:
        fail("source_snapshot requires explicit declared srcs")
    _source_snapshot(
        name = name,
        srcs = srcs,
        graph = graph,
    )
