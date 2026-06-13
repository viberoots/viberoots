load("@viberoots//build-tools/lang:link_intent.bzl", "merge_link_intent_deps", "validate_link_closure_overrides")

def _link_intent_probe_impl(ctx):
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, "ok\n")
    return [DefaultInfo(default_output = out)]

_link_intent_probe_rule = rule(
    impl = _link_intent_probe_impl,
    attrs = {
        "deps": attrs.list(attrs.dep(), default = []),
        "out": attrs.string(default = "link_intent_probe.txt"),
    },
)

def link_intent_probe(
        name,
        deps = None,
        link_deps = None,
        header_deps = None,
        link_closure = None,
        link_closure_overrides = None,
        visibility = None):
    """
    Test-only probe macro: validates/merges link intent lists and exposes the merged result
    via the underlying rule's `deps` attribute for buck2 cquery.
    """
    _ = link_closure  # reserved for planner-level semantics; unused in the probe
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    _link_intent_probe_rule(
        name = name,
        deps = merged,
        visibility = visibility,
    )

__all__ = [
    "link_intent_probe",
]


