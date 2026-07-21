def validate_remote_builder_smoke_declaration(smoke, policy):
    if sorted(smoke.keys()) != ["builder_policy", "path", "schema", "validation"]:
        fail("remote-ready action rejects fabricated remote-builder result claims at analysis time")
    if smoke.get("schema") != "viberoots.remote-builder-smoke-evidence.v2":
        fail("remote-ready action requires declared v2 remote_builder_smoke evidence")
    if not smoke.get("path"):
        fail("remote-ready action requires remote_builder_smoke.path")
    if smoke.get("builder_policy") != policy:
        fail("remote-ready action requires matching remote-builder smoke policy")
    if smoke.get("validation") != "actual-report-required":
        fail("remote-ready action requires runtime validation of the actual remote-builder report")

def remote_builder_smoke_declaration(path, policy):
    return {
        "builder_policy": policy,
        "path": str(path),
        "schema": "viberoots.remote-builder-smoke-evidence.v2",
        "validation": "actual-report-required",
    }
