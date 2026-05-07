def _optional_label(attr):
    return "" if attr == None else str(attr.label)

def _label_list(attrs):
    return [str(attr.label) for attr in attrs]

def _deployment_document(ctx):
    smoke = dict(ctx.attrs.smoke)
    if ctx.attrs.smoke_exception:
        smoke["exception"] = ctx.attrs.smoke_exception
    return {
        "name": ctx.label.name,
        "provider": ctx.attrs.provider,
        "component_kind": ctx.attrs.component_kind,
        "component": str(ctx.attrs.component.label),
        "components": ctx.attrs.components,
        "publisher": ctx.attrs.publisher,
        "publisher_config": ctx.attrs.publisher_config,
        "provisioner": ctx.attrs.provisioner,
        "provisioner_config": ctx.attrs.provisioner_config,
        "protection_class": ctx.attrs.protection_class,
        "lane_policy": _optional_label(ctx.attrs.lane_policy),
        "environment_stage": ctx.attrs.environment_stage,
        "admission_policy": _optional_label(ctx.attrs.admission_policy),
        "rollout_policy": ctx.attrs.rollout_policy,
        "rollout_steps": ctx.attrs.rollout_steps,
        "app_name": ctx.attrs.app_name,
        "container_port": ctx.attrs.container_port,
        "health_path": ctx.attrs.health_path,
        "target_group": ctx.attrs.target_group,
        "provider_target": ctx.attrs.provider_target,
        "vault_runtime": ctx.attrs.vault_runtime,
        "smoke": smoke,
        "smoke_exception": ctx.attrs.smoke_exception,
        "preview": ctx.attrs.preview,
        "bootstrap": ctx.attrs.bootstrap,
        "prerequisites": ctx.attrs.prerequisites,
        "secret_requirements": ctx.attrs.secret_requirements,
        "runtime_config_requirements": ctx.attrs.runtime_config_requirements,
        "external_requirement_profiles": ctx.attrs.external_requirement_profiles,
        "release_actions": _label_list(ctx.attrs.release_actions),
        "target_exceptions": _label_list(ctx.attrs.target_exceptions),
        "migration_bundle": _optional_label(ctx.attrs.migration_bundle),
    }

def _deployment_target_impl(ctx):
    out = ctx.actions.write_json(ctx.label.name + ".json", _deployment_document(ctx))
    return [DefaultInfo(default_output = out)]

deployment_target = rule(
    impl = _deployment_target_impl,
    attrs = {
        "provider": attrs.string(),
        "component": attrs.dep(),
        "component_kind": attrs.string(),
        "publisher": attrs.string(),
        "publisher_config": attrs.string(default = ""),
        "provisioner": attrs.string(default = ""),
        "provisioner_config": attrs.string(default = ""),
        "protection_class": attrs.string(default = "shared_nonprod"),
        "lane_policy": attrs.option(attrs.dep(), default = None),
        "environment_stage": attrs.string(default = ""),
        "admission_policy": attrs.option(attrs.dep(), default = None),
        "components": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "rollout_policy": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "rollout_steps": attrs.list(attrs.string(), default = []),
        "app_name": attrs.string(default = ""),
        "container_port": attrs.int(default = 0),
        "health_path": attrs.string(default = ""),
        "target_group": attrs.string(default = ""),
        "provider_target": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "vault_runtime": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "smoke": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "smoke_exception": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "preview": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "bootstrap": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "prerequisites": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "secret_requirements": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "runtime_config_requirements": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "external_requirement_profiles": attrs.list(attrs.string(), default = []),
        "release_actions": attrs.list(attrs.dep(), default = []),
        "target_exceptions": attrs.list(attrs.dep(), default = []),
        "migration_bundle": attrs.option(attrs.dep(), default = None),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

def _write_stub_json(ctx):
    out = ctx.actions.declare_output(ctx.label.name + ".json")
    ctx.actions.write(out, "{}\n")
    return [DefaultInfo(default_output = out)]

deployment_lane_policy = rule(
    impl = _write_stub_json,
    attrs = {
        "defaults": attrs.option(attrs.dep(), default = None),
        "stages": attrs.list(attrs.string()),
        "stage_branches": attrs.dict(key = attrs.string(), value = attrs.string()),
        "allowed_promotion_edges": attrs.list(attrs.string(), default = []),
        "artifact_reuse_mode": attrs.string(default = "same_artifact"),
        "promotion_compatibility": attrs.string(default = ""),
        "governance_policy": attrs.option(attrs.dep(), default = None),
        "default_client_profile": attrs.string(default = ""),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

deployment_defaults = rule(
    impl = _write_stub_json,
    attrs = {
        "default_client_profile": attrs.string(default = ""),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

deployment_lane_governance = rule(
    impl = _write_stub_json,
    attrs = {
        "scm_backend": attrs.string(),
        "repository": attrs.string(),
        "branch_protections": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

deployment_admission_policy = rule(
    impl = _write_stub_json,
    attrs = {
        "allowed_refs": attrs.list(attrs.string()),
        "required_checks": attrs.list(attrs.string(), default = []),
        "required_approvals": attrs.list(attrs.string(), default = []),
        "readiness_gates": attrs.list(
            attrs.dict(key = attrs.string(), value = attrs.string()),
            default = [],
        ),
        "retry_branch_policy": attrs.string(default = "branch_independent"),
        "retry_approval_reuse": attrs.string(default = "fresh_only"),
        "artifact_attestation_mode": attrs.string(default = "recorded_exact_artifact"),
        "trusted_builder_identities": attrs.list(attrs.string(), default = []),
        "accepted_provenance_formats": attrs.list(attrs.string(), default = []),
        "artifact_binding": attrs.string(default = ""),
        "expired_attestation_behavior": attrs.string(default = ""),
        "revoked_attestation_behavior": attrs.string(default = ""),
        "attestation_trust_drift_behavior": attrs.string(default = ""),
        "require_artifact_signatures": attrs.bool(default = False),
        "trusted_signer_identities": attrs.list(attrs.string(), default = []),
        "sbom_required": attrs.bool(default = False),
        "accepted_sbom_formats": attrs.list(attrs.string(), default = []),
        "supply_chain_gates": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

deployment_release_action = rule(
    impl = _write_stub_json,
    attrs = {
        "type": attrs.string(),
        "phase": attrs.string(),
        "run_condition": attrs.string(),
        "abort_behavior": attrs.string(),
        "data_compatibility": attrs.string(),
        "replay_policy": attrs.dict(key = attrs.string(), value = attrs.string()),
        "duplicate_safety": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "operation_keys": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "required_secret_requirements": attrs.list(attrs.string(), default = []),
        "required_runtime_config_requirements": attrs.list(attrs.string(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)

deployment_target_exception = rule(
    impl = _write_stub_json,
    attrs = {
        "exception_id": attrs.string(default = ""),
        "exception_kind": attrs.string(),
        "affected_deployments": attrs.list(attrs.string()),
        "old_provider_target_identity": attrs.string(),
        "new_provider_target_identity": attrs.string(default = ""),
        "shared_lock_scope": attrs.string(),
        "approval_evidence": attrs.string(),
        "effective_at": attrs.string(),
        "expires_at": attrs.string(default = ""),
        "completion_signal": attrs.string(default = ""),
        "reconciliation_owner": attrs.string(),
        "labels": attrs.list(attrs.string(), default = []),
    },
)
