NIX_STORE_MATERIALIZATION_SCHEMA = "viberoots.nix-store-materialization.v1"

def nix_store_materialization_manifest(
        source_revision,
        source_snapshot,
        flake_lock_fingerprint,
        trusted_public_keys,
        nix_tool,
        store_paths,
        substituter_endpoint_identity = ""):
    """
    Build the remote-ready Nix store materialization evidence dictionary.
    """
    _require_string(source_revision, "source_revision")
    _require_string(source_snapshot, "source_snapshot")
    _require_string(flake_lock_fingerprint, "flake_lock_fingerprint")
    _require_store_path(nix_tool, "nix_tool")
    if type(trusted_public_keys) != "list":
        fail("trusted_public_keys must be a list")
    if type(store_paths) != "list" or len(store_paths) == 0:
        fail("store_paths must list at least one required path")
    for entry in store_paths:
        if type(entry) != "dict":
            fail("store_paths entries must be dictionaries")
        _require_string(entry.get("attr"), "store_paths.attr")
        _require_store_path(entry.get("path"), "store_paths.path")
        _require_string(entry.get("expectedOutputIdentity"), "store_paths.expectedOutputIdentity")
    substituter = {
        "trustedPublicKeys": trusted_public_keys,
    }
    if substituter_endpoint_identity:
        substituter["endpointIdentity"] = substituter_endpoint_identity
    return {
        "schemaVersion": NIX_STORE_MATERIALIZATION_SCHEMA,
        "sourceRevision": source_revision,
        "sourceSnapshot": source_snapshot,
        "flakeLockFingerprint": flake_lock_fingerprint,
        "substituter": substituter,
        "tools": {
            "nix": nix_tool,
        },
        "storePaths": store_paths,
    }

def materialization_manifest_labels(manifest):
    if type(manifest) != "dict" or manifest.get("schemaVersion") != NIX_STORE_MATERIALIZATION_SCHEMA:
        fail("materialization manifest must use %s" % NIX_STORE_MATERIALIZATION_SCHEMA)
    labels = ["materialization-manifest:declared"]
    for entry in manifest.get("storePaths", []):
        _require_store_path(entry.get("path"), "storePaths.path")
        labels.append("materialization-manifest:path=%s" % entry.get("path"))
    return labels

def remote_materialization_evidence(manifest):
    return {
        "materialization_manifest": manifest,
    }

def _require_string(value, name):
    if type(value) != "string" or not value:
        fail("%s is required" % name)

def _require_store_path(value, name):
    _require_string(value, name)
    if not value.startswith("/nix/store/"):
        fail("%s must be a /nix/store path" % name)
