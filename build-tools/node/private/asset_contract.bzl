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

def app_metadata(package, app):
    if not isinstance(app, str) or app == "":
        fail("node_asset_stage: app must be a non-empty target label")
    normalized = "//%s%s" % (package, app) if app.startswith(":") else app
    if not normalized.startswith("//"):
        fail("node_asset_stage: app must be a same-cell target label")
    return "node-stage-app-v1|" + normalized

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
        if source == "":
            fail("node_asset_stage: each asset requires non-empty src")
        if source.startswith("@") and not source.startswith("@viberoots//"):
            fail("node_asset_stage: asset source uses unsupported cell label '%s'" % source)
        if not source.startswith("//") and not source.startswith("@viberoots//"):
            if source.startswith("/") or ".." in source.split("/"):
                fail("node_asset_stage: asset source must stay inside its source root")
        artifact_name = asset.get("artifact_name") or ""
        artifact_glob = asset.get("artifact_glob") or ""
        explicit_kind = asset.get("kind") or ""
        canonical_root_file = source.startswith("@viberoots//:") and "/" not in source[len("@viberoots//:"):]
        inferred_wasm = source.endswith(".wasm") or destination.endswith(".wasm") or artifact_name != "" or artifact_glob != ""
        if explicit_kind == "" and not inferred_wasm and "." not in destination and not canonical_root_file:
            fail("node_asset_stage: extensionless assets require explicit kind = 'file' or 'wasm'")
        kind = explicit_kind or ("wasm" if inferred_wasm else "file")
        if kind not in ["file", "wasm"]:
            fail("node_asset_stage: asset kind must be 'file' or 'wasm'")
        if kind == "file" and (artifact_name != "" or artifact_glob != ""):
            fail("node_asset_stage: file assets cannot set artifact_name or artifact_glob")
        source_path = asset.get("source_path") or ""
        output_path = asset.get("output_path") or ""
        provenance = asset.get("provenance") or ""
        if provenance != "" and not provenance.startswith("//") and not provenance.startswith(":"):
            fail("node_asset_stage: provenance must be an explicit target label")
        if kind == "file" and (source.startswith("//") or source.startswith("@viberoots//")):
            if source_path == "" and canonical_root_file:
                source_path = source[len("@viberoots//:"):]
            elif source_path == "" and output_path == "":
                fail("node_asset_stage: labeled file assets require source_path or output_path")
        if source_path != "" and output_path != "":
            fail("node_asset_stage: file assets cannot set both source_path and output_path")
        if source_path.startswith("/") or ".." in source_path.split("/"):
            fail("node_asset_stage: asset source_path must stay inside its source root")
        if output_path.startswith("/") or ".." in output_path.split("/"):
            fail("node_asset_stage: asset output_path must stay inside its dependency artifact")
        fields = [source, destination, artifact_name, artifact_glob, kind, source_path, output_path, provenance]
        for field in fields:
            if "|" in field or "\n" in field:
                fail("node_asset_stage: asset metadata fields cannot contain '|' or newlines")
        metadata.append("node-asset-v5|" + "|".join(fields))
    return metadata

__all__ = ["app_metadata", "asset_metadata", "module_surface_labels"]
