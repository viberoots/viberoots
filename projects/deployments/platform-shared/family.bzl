load("//build-tools/deployments:defs.bzl", "opentofu_foundation_deployment")
load("//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")
load("//projects/deployments/platform-shared:phase0_contracts.bzl", "phase0_readiness_secrets", "phase0_secret", "phase0_stack_target", "phase0_vault_runtime")

def _family_defaults():
    return deployment_family_defaults(
        component = "//projects/deployments/platform-shared:migration_bundle",
        lane_policy = "//projects/deployments/platform-shared:lane",
        provisioner_config = "opentofu/stack.json",
    )

def _stage_secrets(stage):
    deployment = "platform-foundation-%s" % stage
    return [
        phase0_secret("opentofu-provider-credentials", deployment, "provision"),
        phase0_secret("supabase-service-role", deployment, "provision"),
    ] + phase0_readiness_secrets()

def platform_foundation_deployment(name, stage, admission_policy, protection_class, prerequisite = ""):
    prerequisites = [] if not prerequisite else [{"deployment_id": prerequisite, "mode": "ordering_only"}]
    opentofu_foundation_deployment(**compose_deployment_family_kwargs(
        _family_defaults(),
        deployment_stage_delta(
            stage = stage,
            admission_policy = "//projects/deployments/platform-shared:%s" % admission_policy,
            protection_class = protection_class,
            provider_target = phase0_stack_target("platform-foundation", stage),
            resource_sizing = {"profile": "phase0-foundation-baseline"},
            vault_runtime = phase0_vault_runtime("deploy-platform-foundation-%s-read" % stage),
            secret_requirements = _stage_secrets(stage),
            prerequisites = prerequisites,
        ),
        provider_args = {"name": name},
    ))
