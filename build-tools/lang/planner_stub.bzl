def _planner_stub_impl(ctx):
    """
    Planner-visible stub rule.

    This rule exists only to create a uniform, planner-discoverable node in the Buck graph:
    - `deps` creates graph edges
    - `labels` is exported for planner/exporter routing
    - `srcs` optionally carries package-local file inputs for discovery/invalidation
    - outputs a small deterministic stamp file
    """
    out_name = ctx.attrs.out
    if not out_name:
        out_name = ctx.label.name + ".stamp"
    out = ctx.actions.declare_output(out_name)

    labels = ctx.attrs.labels or []
    # Deterministic output content (and stable diff): sort labels, count srcs/deps.
    stable_labels = sorted([l for l in labels if isinstance(l, str)])
    content = "\n".join([
        "planner_stub",
        "labels=" + ",".join(stable_labels),
        "srcs=" + str(len(ctx.attrs.srcs or [])),
        "deps=" + str(len(ctx.attrs.deps or [])),
        "",
    ])
    ctx.actions.write(out, content)
    return [DefaultInfo(default_output = out)]


planner_stub = rule(
    impl = _planner_stub_impl,
    attrs = {
        # Optional: lets callers keep stable output naming; defaults to "<name>.stamp".
        "out": attrs.string(default = ""),
        "deps": attrs.list(attrs.dep(), default = []),
        # Link intent surface (planner/exporter contract; unused by this rule impl).
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        # Shared-lib opt-in (planner/exporter contract; unused by this rule impl).
        "link_mode": attrs.string(default = "static"),
        "nixpkgs_profile": attrs.string(default = "default"),
        "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
        # `attrs.source()` allows both files and target outputs (like genrule srcs),
        # which is useful for planner-only nodes that must carry edges via srcs.
        "srcs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

load("@viberoots//build-tools/lang:patch_inputs.bzl", "include_package_local_patches")

def planner_stub_with_package_local_patches(
        name,
        lang,
        local_patch_dirs = None,
        deps = [],
        srcs = [],
        labels = [],
        **kwargs):
    kw = dict(kwargs)
    kw["name"] = name
    kw["deps"] = deps or []
    kw["labels"] = labels or []
    kw["srcs"] = srcs or []
    include_package_local_patches(kw, lang, local_patch_dirs)
    planner_stub(**kw)


