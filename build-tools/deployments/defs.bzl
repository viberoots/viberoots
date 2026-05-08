load(
    "//build-tools/deployments:metadata_rules.bzl",
    _deployment_admission_policy = "deployment_admission_policy",
    _deployment_defaults = "deployment_defaults",
    _deployment_lane_governance = "deployment_lane_governance",
    _deployment_lane_policy = "deployment_lane_policy",
    _deployment_release_action = "deployment_release_action",
    _deployment_target = "deployment_target",
    _deployment_target_exception = "deployment_target_exception",
)
load("//build-tools/deployments:github_app_requirements.bzl", _github_app_requirements = "github_app_requirements")
load("//build-tools/deployments:migration_bundle_rules.bzl", _migration_bundle = "migration_bundle")
load("//build-tools/deployments:opentofu_defs.bzl", _opentofu_foundation_deployment = "opentofu_foundation_deployment")
load(
    "//build-tools/deployments:nixos_shared_host_defs.bzl",
    _nixos_shared_host_multi_static_webapp_deployment = "nixos_shared_host_multi_static_webapp_deployment",
    _nixos_shared_host_ssr_webapp_deployment = "nixos_shared_host_ssr_webapp_deployment",
    _nixos_shared_host_static_webapp_deployment = "nixos_shared_host_static_webapp_deployment",
    _require_shared_policy = "require_shared_policy",
)
load("//build-tools/deployments:s3_defs.bzl", _s3_static_webapp_deployment = "s3_static_webapp_deployment")
load("//build-tools/deployments:vercel_defs.bzl", _vercel_next_webapp_deployment = "vercel_next_webapp_deployment")
load("//build-tools/deployments:kubernetes_defs.bzl", _kubernetes_service_deployment = "kubernetes_service_deployment")

deployment_admission_policy = _deployment_admission_policy
deployment_defaults = _deployment_defaults
deployment_lane_governance = _deployment_lane_governance
deployment_lane_policy = _deployment_lane_policy
deployment_release_action = _deployment_release_action
deployment_target = _deployment_target
deployment_target_exception = _deployment_target_exception
github_app_requirements = _github_app_requirements
migration_bundle = _migration_bundle

def nixos_shared_host_static_webapp_deployment(**kwargs):
    _nixos_shared_host_static_webapp_deployment(
        deployment_target = deployment_target,
        **kwargs
    )

def nixos_shared_host_ssr_webapp_deployment(**kwargs):
    _nixos_shared_host_ssr_webapp_deployment(
        deployment_target = deployment_target,
        **kwargs
    )

def nixos_shared_host_multi_static_webapp_deployment(**kwargs):
    _nixos_shared_host_multi_static_webapp_deployment(
        deployment_target = deployment_target,
        **kwargs
    )

def cloudflare_pages_static_webapp_deployment(
        name,
        component,
        account,
        project,
        account_id = "",
        project_id = "",
        custom_domain = "",
        custom_domain_zone_id = "",
        smoke = None,
        smoke_exception = None,
        preview = None,
        publisher = "wrangler-pages",
        publisher_config = "wrangler.jsonc",
        protection_class = "shared_nonprod",
        lane_policy = None,
        environment_stage = "",
        admission_policy = None,
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        external_requirement_profiles = [],
        vault_runtime = {},
        release_actions = [],
        target_exceptions = [],
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        _require_shared_policy(lane_policy, environment_stage, admission_policy)
    deployment_target(
        name = name,
        provider = "cloudflare-pages",
        component = component,
        component_kind = "static-webapp",
        publisher = publisher,
        publisher_config = publisher_config,
        protection_class = protection_class,
        lane_policy = lane_policy,
        environment_stage = environment_stage,
        admission_policy = admission_policy,
        components = [{
            "id": "default",
            "kind": "static-webapp",
            "target": component,
        }],
        provider_target = {
            "account": account,
            "account_id": account_id,
            "project": project,
            "id": project_id if project_id else project,
            "custom_domain": custom_domain,
            "custom_domain_zone_id": custom_domain_zone_id,
        },
        smoke = smoke or {},
        smoke_exception = smoke_exception or {},
        preview = preview or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        external_requirement_profiles = external_requirement_profiles,
        vault_runtime = vault_runtime,
        release_actions = release_actions,
        target_exceptions = target_exceptions,
        labels = labels + [
            "kind:deployment",
            "deployment:cloudflare-pages",
            "deployment-component:static-webapp",
        ],
        visibility = visibility,
    )

def cloudflare_containers_deployment(
        name,
        component,
        cloudflare_account_id,
        worker,
        component_kind = "service",
        ingress_mode = "public",
        domain = "",
        cloudflare_zone_id = "",
        container_port = 8080,
        health_path = "/healthz",
        workers_dev_exception = False,
        sleep_after = "10m",
        max_instances = "1",
        publisher = "cloudflare-containers-local",
        publisher_config = "wrangler.jsonc",
        protection_class = "shared_nonprod",
        lane_policy = None,
        environment_stage = "",
        admission_policy = None,
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        external_requirement_profiles = [],
        vault_runtime = {},
        smoke = None,
        smoke_exception = None,
        release_actions = [],
        target_exceptions = [],
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        _require_shared_policy(lane_policy, environment_stage, admission_policy)
    deployment_target(
        name = name,
        provider = "cloudflare-containers",
        component = component,
        component_kind = component_kind,
        publisher = publisher,
        publisher_config = publisher_config,
        protection_class = protection_class,
        lane_policy = lane_policy,
        environment_stage = environment_stage,
        admission_policy = admission_policy,
        components = [{
            "id": "default",
            "kind": component_kind,
            "target": component,
        }],
        provider_target = {
            "account_id": cloudflare_account_id,
            "worker": worker,
            "ingress_mode": ingress_mode,
            "domain": domain,
            "cloudflare_zone_id": cloudflare_zone_id,
            "container_port": str(container_port),
            "health_path": health_path,
            "workers_dev_exception": "true" if workers_dev_exception else "false",
            "sleep_after": sleep_after,
            "max_instances": max_instances,
        },
        smoke = smoke or {},
        smoke_exception = smoke_exception or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        external_requirement_profiles = external_requirement_profiles,
        vault_runtime = vault_runtime,
        release_actions = release_actions,
        target_exceptions = target_exceptions,
        labels = labels + [
            "kind:deployment",
            "deployment:cloudflare-containers",
            "deployment-component:" + component_kind,
        ],
        visibility = visibility,
    )

def s3_static_webapp_deployment(**kwargs):
    _s3_static_webapp_deployment(
        deployment_target = deployment_target,
        require_shared_policy = _require_shared_policy,
        **kwargs
    )

def vercel_next_webapp_deployment(**kwargs):
    _vercel_next_webapp_deployment(
        deployment_target = deployment_target,
        require_shared_policy = _require_shared_policy,
        **kwargs
    )

def kubernetes_service_deployment(**kwargs):
    _kubernetes_service_deployment(
        deployment_target = deployment_target,
        require_shared_policy = _require_shared_policy,
        **kwargs
    )

def opentofu_foundation_deployment(**kwargs):
    _opentofu_foundation_deployment(
        deployment_target = deployment_target,
        require_shared_policy = _require_shared_policy,
        **kwargs
    )

def container_runtime_service_deployment(**kwargs):
    kubernetes_service_deployment(**kwargs)
