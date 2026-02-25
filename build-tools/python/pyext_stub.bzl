def _pyext_stub_impl(ctx):
    """
    Planner-visible stub rule for Python native extension modules (kind:pyext).

    This rule exists only to create a uniform, planner-discoverable node in the Buck graph:
    - `deps` creates graph edges
    - `labels` is exported for planner/exporter routing
    - `srcs` carries file inputs for discovery/invalidation (C/C++ sources, headers)
    - `module` records the Python import name (e.g. "mypkg._native")
    - link intent attrs are preserved as part of the exported node contract
    - outputs a small deterministic stamp file
    """
    out_name = ctx.attrs.out
    if not out_name:
        out_name = ctx.label.name + ".stamp"
    out = ctx.actions.declare_output(out_name)

    labels = ctx.attrs.labels or []
    stable_labels = sorted([l for l in labels if isinstance(l, str)])
    module = ctx.attrs.module or ""

    # Deterministic output content (and stable diff): sort labels, count srcs/deps.
    content = "\n".join([
        "python_pyext_stub",
        "module=" + module,
        "labels=" + ",".join(stable_labels),
        "srcs=" + str(len(ctx.attrs.srcs or [])),
        "deps=" + str(len(ctx.attrs.deps or [])),
        "",
    ])
    ctx.actions.write(out, content)
    return [DefaultInfo(default_output = out)]


python_pyext_stub = rule(
    impl = _pyext_stub_impl,
    attrs = {
        # Optional: lets callers keep stable output naming; defaults to "<name>.stamp".
        "out": attrs.string(default = ""),
        "module": attrs.string(default = ""),
        "deps": attrs.list(attrs.dep(), default = []),
        # Link intent surface (planner/exporter contract; unused by this rule impl).
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        # Preserve compile/link flags in the exported node contract.
        "cflags": attrs.list(attrs.string(), default = []),
        "ldflags": attrs.list(attrs.string(), default = []),
        # Build-time Python deps (from importer uv.lock wheelhouse env).
        # This is a planner/exporter contract only; this stub does not interpret it.
        "build_py_deps": attrs.list(attrs.string(), default = []),
        # `attrs.source()` allows both files and target outputs (like genrule srcs).
        "srcs": attrs.list(attrs.source(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)


__all__ = [
    "python_pyext_stub",
]


