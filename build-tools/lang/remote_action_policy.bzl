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

_REMOTE_BUILDER_POLICIES_REQUIRING_SMOKE = [
    "inherit_config",
    "force_builders_file",
]

_NIX_BUILDER_POLICIES = [
    "local_only",
    "inherit_config",
    "force_builders_file",
]

NixRemoteActionPolicyInfo = provider(fields = [
    "builder_policy",
    "labels",
    "metadata",
    "remote_builder_smoke_policy",
])

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

_REMOTE_BLOCKED_COMMAND_FRAGMENTS = [
    "WORKSPACE_ROOT",
    "FLK_ROOT",
    "BUCK_TEST_SRC",
    "command -v",
    "path:$FLK_ROOT",
    "build-tools/",
    "/usr/bin/env",
]

def _command_text(command):
    return " ".join([str(part) for part in command])

def external_runner_command(labels, local_command, remote_command = None, declared_inputs = [], required_inputs = []):
    if REMOTE_READY in (labels or []):
        if remote_command == None:
            fail("remote-ready external-runner command requires a separate declared remote command")
        if len(declared_inputs) == 0:
            fail("remote-ready external-runner command requires declared inputs")
        declared_input_ids = [str(item) for item in declared_inputs]
        missing = []
        for required in required_inputs:
            if str(required) not in declared_input_ids:
                missing.append(str(required))
        if missing:
            fail("remote-ready external-runner command missing required declared inputs: %s" % ", ".join(missing))
        text = _command_text(remote_command[1:])
        if '--builders ""' in text or "--builders ''" in text:
            fail("remote-ready external-runner command cannot disable Nix builders")
        blocked = []
        for fragment in _REMOTE_BLOCKED_COMMAND_FRAGMENTS:
            if fragment in text:
                blocked.append(fragment)
        if blocked:
            fail("remote-ready external-runner command contains local workspace/bootstrap fragments: %s" % ", ".join(blocked))
        return [cmd_args(remote_command[0], hidden = declared_inputs)] + remote_command[1:]
    return local_command

def _missing_evidence(evidence):
    values = evidence or {}
    return [key for key in _REMOTE_READY_EVIDENCE if not values.get(key)]

def _validate_builder_evidence(evidence):
    values = evidence or {}
    policy = values.get("builder_policy")
    if type(policy) != "string" or policy not in _NIX_BUILDER_POLICIES:
        fail("remote-ready action requires typed builder_policy evidence")
    if policy == "local_only":
        fail("remote-ready action cannot use local_only Nix builder policy")
    if policy in _REMOTE_BUILDER_POLICIES_REQUIRING_SMOKE:
        smoke_policy = values.get("remote_builder_smoke")
        if type(smoke_policy) == "dict":
            smoke_policy = smoke_policy.get("builder_policy")
        if type(smoke_policy) != "string":
            fail("remote-ready action requires typed remote_builder_smoke evidence")
        if smoke_policy != policy:
            fail("remote-ready action with %s builder policy requires matching remote_builder_smoke evidence" % policy)

def _validate_source_snapshot_evidence(evidence):
    snapshot = (evidence or {}).get("source_snapshot")
    if type(snapshot) != "dict":
        fail("remote-ready action requires typed source_snapshot evidence")
    if not snapshot.get("declared_root"):
        fail("remote-ready action requires source_snapshot.declared_root")
    if not snapshot.get("manifest"):
        fail("remote-ready action requires source_snapshot.manifest")
    if not snapshot.get("graph_path"):
        fail("remote-ready action requires source_snapshot.graph_path")

def _policy_labels(evidence, default_builder_policy):
    values = evidence or {}
    builder_policy = values.get("builder_policy")
    if type(builder_policy) != "string":
        builder_policy = default_builder_policy
    labels = ["nix-builder:%s" % builder_policy]
    if values.get("artifact_contract"):
        labels.append("artifact-contract:declared")
    if values.get("materialization_manifest"):
        labels.append("materialization-manifest:declared")
        manifest = values.get("materialization_manifest")
        if type(manifest) == "dict":
            for entry in manifest.get("storePaths", []):
                if type(entry) == "dict" and entry.get("path"):
                    labels.append("materialization-manifest:path=%s" % entry.get("path"))
    smoke_policy = values.get("remote_builder_smoke")
    if type(smoke_policy) == "dict":
        smoke_policy = smoke_policy.get("builder_policy")
    if type(smoke_policy) == "string":
        labels.append("remote-builder-smoke:%s" % smoke_policy)
    return labels

def remote_action_policy(
        mode = "local-only",
        evidence = None,
        fallback_reason = None):
    if mode == "local-only":
        return struct(
            local_only = True,
            builder_policy = "local_only",
            labels = _policy_labels(evidence, "local_only"),
            metadata = "remote-action-policy:local-only",
            remote_builder_smoke_policy = None,
            stamp = "remote_action_policy_local_only",
        )
    if mode == "remote-ready":
        missing = _missing_evidence(evidence)
        if missing:
            fail("remote-ready action missing evidence: %s" % ", ".join(missing))
        _validate_source_snapshot_evidence(evidence)
        _validate_builder_evidence(evidence)
        return struct(
            local_only = False,
            builder_policy = evidence.get("builder_policy"),
            labels = _policy_labels(evidence, "inherit_config"),
            metadata = "remote-action-policy:remote-ready",
            remote_builder_smoke_policy = evidence.get("remote_builder_smoke"),
            stamp = "remote_action_policy_remote_ready",
        )
    if mode == "hybrid":
        missing = _missing_evidence(evidence)
        if missing:
            fail("hybrid action missing evidence: %s" % ", ".join(missing))
        _validate_source_snapshot_evidence(evidence)
        _validate_builder_evidence(evidence)
        if not fallback_reason:
            fail("hybrid action requires fallback_reason")
        return struct(
            local_only = False,
            builder_policy = evidence.get("builder_policy"),
            labels = _policy_labels(evidence, "inherit_config"),
            metadata = "remote-action-policy:hybrid",
            remote_builder_smoke_policy = evidence.get("remote_builder_smoke"),
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
    return [NixRemoteActionPolicyInfo(
        builder_policy = policy.builder_policy,
        labels = policy.labels,
        metadata = policy.metadata,
        remote_builder_smoke_policy = policy.remote_builder_smoke_policy,
    )]
