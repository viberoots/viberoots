load(
    "//build-tools/deployments:metadata_rules.bzl",
    _deployment_admission_policy = "deployment_admission_policy",
    _deployment_lane_policy = "deployment_lane_policy",
    _deployment_release_action = "deployment_release_action",
    _deployment_target = "deployment_target",
    _deployment_target_exception = "deployment_target_exception",
)
load("//build-tools/deployments:s3_defs.bzl", _s3_static_webapp_deployment = "s3_static_webapp_deployment")

deployment_admission_policy = _deployment_admission_policy
deployment_lane_policy = _deployment_lane_policy
deployment_release_action = _deployment_release_action
deployment_target = _deployment_target
deployment_target_exception = _deployment_target_exception

def _require_shared_policy(lane_policy, environment_stage, admission_policy):
    if lane_policy == None:
        fail("protected/shared deployments must set lane_policy")
    if not environment_stage:
        fail("protected/shared deployments must set environment_stage")
    if admission_policy == None:
        fail("protected/shared deployments must set admission_policy")
def nixos_shared_host_static_webapp_deployment(
        name,
        component,
        app_name,
        container_port,
        health_path = "",
        target_group = "",
        publisher = "nixos-shared-host-static-webapp",
        provisioner = "nixos-shared-host-manifest",
        protection_class = "shared_nonprod",
        lane_policy = None,
        environment_stage = "",
        admission_policy = None,
        bootstrap = None,
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        release_actions = [],
        target_exceptions = [],
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        _require_shared_policy(lane_policy, environment_stage, admission_policy)
    deployment_target(
        name = name,
        provider = "nixos-shared-host",
        component = component,
        component_kind = "static-webapp",
        publisher = publisher,
        provisioner = provisioner,
        protection_class = protection_class,
        lane_policy = lane_policy,
        environment_stage = environment_stage,
        admission_policy = admission_policy,
        components = [{
            "id": "default",
            "kind": "static-webapp",
            "target": component,
            "app_name": app_name,
            "container_port": str(container_port),
            "health_path": health_path,
            "target_group": target_group,
        }],
        app_name = app_name,
        container_port = container_port,
        health_path = health_path,
        target_group = target_group,
        bootstrap = bootstrap or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        release_actions = release_actions,
        target_exceptions = target_exceptions,
        labels = labels + [
            "kind:deployment",
            "deployment:nixos-shared-host",
            "deployment-component:static-webapp",
        ],
        visibility = visibility,
    )
def nixos_shared_host_multi_static_webapp_deployment(
        name,
        components,
        rollout_policy,
        target_group = "",
        publisher = "nixos-shared-host-static-webapp",
        provisioner = "nixos-shared-host-manifest",
        protection_class = "shared_nonprod",
        lane_policy = None,
        environment_stage = "",
        admission_policy = None,
        bootstrap = None,
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        release_actions = [],
        target_exceptions = [],
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        _require_shared_policy(lane_policy, environment_stage, admission_policy)
    rollout_steps = rollout_policy.get("steps", [])
    rollout_fields = {
        "mode": rollout_policy.get("mode", ""),
        "abort": rollout_policy.get("abort", ""),
        "smoke": rollout_policy.get("smoke", ""),
    }
    deployment_target(
        name = name,
        provider = "nixos-shared-host",
        component = components[0]["target"],
        component_kind = "static-webapp",
        publisher = publisher,
        provisioner = provisioner,
        protection_class = protection_class,
        lane_policy = lane_policy,
        environment_stage = environment_stage,
        admission_policy = admission_policy,
        components = [
            {
                "id": component["id"],
                "kind": "static-webapp",
                "target": component["target"],
                "app_name": component["app_name"],
                "container_port": str(component["container_port"]),
                "health_path": component.get("health_path", ""),
                "target_group": component.get("target_group", target_group),
            }
            for component in components
        ],
        rollout_policy = rollout_fields,
        rollout_steps = rollout_steps,
        target_group = target_group,
        bootstrap = bootstrap or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        release_actions = release_actions,
        target_exceptions = target_exceptions,
        labels = labels + [
            "kind:deployment",
            "deployment:nixos-shared-host",
            "deployment-component:static-webapp",
            "deployment:multi-component",
        ],
        visibility = visibility,
    )
def cloudflare_pages_static_webapp_deployment(
        name,
        component,
        account,
        project,
        project_id = "",
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
            "project": project,
            "id": project_id if project_id else project,
        },
        preview = preview or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        release_actions = release_actions,
        target_exceptions = target_exceptions,
        labels = labels + [
            "kind:deployment",
            "deployment:cloudflare-pages",
            "deployment-component:static-webapp",
        ],
        visibility = visibility,
    )

def s3_static_webapp_deployment(**kwargs):
    _s3_static_webapp_deployment(
        deployment_target = deployment_target,
        require_shared_policy = _require_shared_policy,
        **kwargs
    )
