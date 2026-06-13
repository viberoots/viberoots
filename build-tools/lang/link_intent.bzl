load("@viberoots//build-tools/lang:collections.bzl", "dedupe_preserve")

def merge_link_intent_deps(deps, link_deps, header_deps):
    """
    Deterministic union used by macro-level linking intent surfaces.

    Contract:
      deps := deps ∪ link_deps ∪ header_deps

    Ordering:
      - preserve first occurrence order across (deps, link_deps, header_deps)
      - stable, deterministic output (no sorting)
    """
    if deps == None:
        deps = []
    if link_deps == None:
        link_deps = []
    if header_deps == None:
        header_deps = []

    if not isinstance(deps, list):
        fail("deps must be a list")
    if not isinstance(link_deps, list):
        fail("link_deps must be a list")
    if not isinstance(header_deps, list):
        fail("header_deps must be a list")

    return dedupe_preserve(list(deps) + list(link_deps) + list(header_deps))

def validate_link_closure_overrides(link_deps, link_closure_overrides):
    """
    Optional validation for planner-level closure overrides:
      - each key in link_closure_overrides must appear in link_deps
    """
    if link_deps == None:
        link_deps = []
    if link_closure_overrides == None:
        return

    if not isinstance(link_deps, list):
        fail("link_deps must be a list")
    if not isinstance(link_closure_overrides, dict):
        fail("link_closure_overrides must be a dict")

    missing = []
    for k in link_closure_overrides.keys():
        if k not in link_deps:
            missing.append(k)
    if missing:
        missing_sorted = sorted(missing)
        fail(
            "link_closure_overrides keys must be present in link_deps; missing: %s" %
            (", ".join(missing_sorted)),
        )

__all__ = [
    "merge_link_intent_deps",
    "validate_link_closure_overrides",
]


