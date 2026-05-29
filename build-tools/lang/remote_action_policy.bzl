REMOTE_LOCAL_ONLY = "remote:local-only"
REMOTE_READY = "remote:ready"
REMOTE_NEEDS_SOURCE_SNAPSHOT = "remote:needs-source-snapshot"
REMOTE_EXTERNAL_READONLY = "remote:external-readonly"
REMOTE_EXTERNAL_MUTATING_LOCKED = "remote:external-mutating-locked"

_REMOTE_LABELS = [
    REMOTE_LOCAL_ONLY,
    REMOTE_READY,
    REMOTE_NEEDS_SOURCE_SNAPSHOT,
    REMOTE_EXTERNAL_READONLY,
    REMOTE_EXTERNAL_MUTATING_LOCKED,
]

_REMOTE_READY_EVIDENCE = [
    "source_snapshot",
    "materialization_manifest",
    "artifact_contract",
    "builder_policy",
    "remote_builder_smoke",
    "remote_profile_compatibility",
]

_GENRULE_LOCAL_SCHEDULING_LABEL = "uses_local_filesystem_abspaths"

def remote_readiness_labels():
    return list(_REMOTE_LABELS)

def stamp_remote_readiness_labels(labels, default = REMOTE_LOCAL_ONLY):
    out = list(labels or [])
    has_remote_label = False
    for label in out:
        if label in _REMOTE_LABELS:
            has_remote_label = True
    if not has_remote_label:
        out.append(default)
    return out

def stamp_local_only_genrule_labels(labels):
    out = stamp_remote_readiness_labels(labels, default = REMOTE_LOCAL_ONLY)
    if _GENRULE_LOCAL_SCHEDULING_LABEL not in out:
        out.append(_GENRULE_LOCAL_SCHEDULING_LABEL)
    return out

def _missing_evidence(evidence):
    values = evidence or {}
    return [key for key in _REMOTE_READY_EVIDENCE if not values.get(key)]

def remote_action_policy(
        mode = "local-only",
        evidence = None,
        fallback_reason = None):
    if mode == "local-only":
        return struct(
            local_only = True,
            metadata = "remote-action-policy:local-only",
            stamp = "remote_action_policy_local_only",
        )
    if mode == "remote-ready":
        missing = _missing_evidence(evidence)
        if missing:
            fail("remote-ready action missing evidence: %s" % ", ".join(missing))
        return struct(
            local_only = False,
            metadata = "remote-action-policy:remote-ready",
            stamp = "remote_action_policy_remote_ready",
        )
    if mode == "hybrid":
        missing = _missing_evidence(evidence)
        if missing:
            fail("hybrid action missing evidence: %s" % ", ".join(missing))
        if not fallback_reason:
            fail("hybrid action requires fallback_reason")
        return struct(
            local_only = False,
            metadata = "remote-action-policy:hybrid",
            stamp = "remote_action_policy_hybrid",
        )
    fail("unknown remote action policy mode: %s" % mode)

def run_nix_action(ctx, cmd, category, mode = "local-only", evidence = None, fallback_reason = None):
    policy = remote_action_policy(
        mode = mode,
        evidence = evidence,
        fallback_reason = fallback_reason,
    )
    ctx.actions.run(
        cmd,
        category = "%s_%s" % (category, policy.stamp),
        local_only = policy.local_only,
    )
