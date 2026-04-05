def _optional_label(attr):
    return "" if attr == None else str(attr.label)
def _deployment_document(ctx):
    return {
        "name": ctx.label.name,
        "provider": ctx.attrs.provider,
        "component_kind": ctx.attrs.component_kind,
        "component": str(ctx.attrs.component.label),
        "components": ctx.attrs.components,
        "publisher": ctx.attrs.publisher,
        "publisher_config": ctx.attrs.publisher_config,
        "provisioner": ctx.attrs.provisioner,
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
        "preview": ctx.attrs.preview,
        "prerequisites": ctx.attrs.prerequisites,
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
        "preview": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "prerequisites": attrs.list(attrs.dict(key = attrs.string(), value = attrs.string()), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)
def _deployment_lane_policy_impl(ctx):
    out = ctx.actions.declare_output(ctx.label.name + ".json")
    ctx.actions.write(out, "{}\n")
    return [DefaultInfo(default_output = out)]
deployment_lane_policy = rule(
    impl = _deployment_lane_policy_impl,
    attrs = {
        "stages": attrs.list(attrs.string()),
        "stage_branches": attrs.dict(key = attrs.string(), value = attrs.string()),
        "allowed_promotion_edges": attrs.list(attrs.string(), default = []),
        "artifact_reuse_mode": attrs.string(default = "same_artifact"),
        "labels": attrs.list(attrs.string(), default = []),
    },
)
def _deployment_admission_policy_impl(ctx):
    out = ctx.actions.declare_output(ctx.label.name + ".json")
    ctx.actions.write(out, "{}\n")
    return [DefaultInfo(default_output = out)]
deployment_admission_policy = rule(
    impl = _deployment_admission_policy_impl,
    attrs = {
        "allowed_refs": attrs.list(attrs.string()),
        "required_checks": attrs.list(attrs.string(), default = []),
        "required_approvals": attrs.list(attrs.string(), default = []),
        "retry_branch_policy": attrs.string(default = "branch_independent"),
        "artifact_attestation_mode": attrs.string(default = "recorded_exact_artifact"),
        "labels": attrs.list(attrs.string(), default = []),
    },
)
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
        prerequisites = [],
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
        prerequisites = prerequisites,
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
        prerequisites = [],
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
        prerequisites = prerequisites,
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
        labels = labels + [
            "kind:deployment",
            "deployment:cloudflare-pages",
            "deployment-component:static-webapp",
        ],
        visibility = visibility,
    )
