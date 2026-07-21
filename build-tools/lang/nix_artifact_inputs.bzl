def nix_artifact_action_inputs(ctx):
    """Canonical declared inputs consumed by the selected-artifact action bootstrap."""
    dependency_outputs = []
    for dep in ctx.attrs.deps:
        if DefaultInfo in dep:
            dependency_outputs.extend(dep[DefaultInfo].default_outputs)
    return ctx.attrs.srcs + ctx.attrs.nix_inputs + dependency_outputs + [
        ctx.attrs._build_selected,
        ctx.attrs._export_graph,
        ctx.attrs._graph_json,
        ctx.attrs._nix_build_filtered_flake,
        ctx.attrs._workspace_root_env,
        ctx.attrs._zx_init,
    ]

def with_nix_artifact_action_attrs(base):
    out = dict(base)
    out.update({
        "_build_selected": attrs.source(default = "@viberoots//build-tools/tools/dev:build-selected.ts"),
        "_export_graph": attrs.source(default = "@viberoots//build-tools/tools/buck:export-graph.ts"),
        "_graph_json": attrs.source(default = "workspace_buck//:graph.json"),
        "_nix_build_filtered_flake": attrs.source(default = "@viberoots//build-tools/tools/dev:nix-build-filtered-flake.ts"),
        "_workspace_root_env": attrs.source(default = "workspace_buck//:workspace-root.env"),
        "_zx_init": attrs.source(default = "@viberoots//build-tools/tools/dev:zx-init.mjs"),
    })
    return out

def nix_artifact_tool_source_labels():
    return [
        "@viberoots//build-tools/tools/buck:export-graph.ts",
        "@viberoots//build-tools/tools/dev:build-selected.ts",
        "@viberoots//build-tools/tools/dev:nix-build-filtered-flake.ts",
        "@viberoots//build-tools/tools/dev:zx-init.mjs",
    ]
