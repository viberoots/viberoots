def _normalize_module_dep_label(package, dep):
    if not isinstance(dep, str) or dep == "":
        fail("node_asset_stage: module_deps entries must be non-empty string labels")
    if dep.startswith(":"):
        if len(dep) == 1:
            fail("node_asset_stage: module_deps local label cannot be empty")
        return "//%s:%s" % (package, dep[1:])
    if not dep.startswith("//"):
        fail("node_asset_stage: module_deps entries must start with // or :")
    if ":" in dep:
        return dep
    pkg = dep[2:]
    if pkg == "":
        fail("node_asset_stage: module_deps package label cannot be empty")
    base = pkg.split("/")[-1]
    if base == "":
        fail("node_asset_stage: module_deps package label cannot end with '/'")
    return "%s:%s" % (dep, base)

def module_surface_labels(package, deps):
    labels = []
    for dep in deps:
        normalized = _normalize_module_dep_label(package, dep)
        parts = normalized[2:].split(":")
        if len(parts) != 2 or parts[0] == "" or parts[1] == "":
            fail("node_asset_stage: failed to normalize module_dep '%s'" % dep)
        labels.append("//%s:%s__surface" % (parts[0], parts[1]))
    return labels

def asset_metadata(package, assets):
    metadata = []
    destinations = {}
    for asset in assets:
        if not isinstance(asset, dict):
            fail("node_asset_stage: each asset must be a dict with src and dest")
        destination = asset.get("dest") or ""
        if destination == "" or destination.startswith("/") or ".." in destination.split("/"):
            fail("node_asset_stage: asset destination must stay inside the staged output")
        if destination in destinations:
            fail("node_asset_stage: duplicate asset destination '%s'" % destination)
        destinations[destination] = True
        source = asset.get("src") or ""
        if source.startswith(":"):
            source = "//%s%s" % (package, source)
        fields = [source, destination, asset.get("artifact_name") or "", asset.get("artifact_glob") or ""]
        for field in fields:
            if "|" in field or "\n" in field:
                fail("node_asset_stage: asset metadata fields cannot contain '|' or newlines")
        metadata.append("node-asset-v1|" + "|".join(fields))
    return metadata

__all__ = ["asset_metadata", "module_surface_labels"]
