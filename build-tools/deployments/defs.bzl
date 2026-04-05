def _optional_label(attr):
    return "" if attr == None else str(attr.label)

def _deployment_target_impl(ctx):
    out = ctx.actions.declare_output(ctx.label.name + ".json")
    lines = [
        "{",
        '  "name": "%s",' % ctx.label.name,
        '  "provider": "%s",' % ctx.attrs.provider,
        '  "component_kind": "%s",' % ctx.attrs.component_kind,
        '  "component": "%s",' % str(ctx.attrs.component.label),
        '  "publisher": "%s",' % ctx.attrs.publisher,
        '  "provisioner": "%s",' % ctx.attrs.provisioner,
        '  "protection_class": "%s",' % ctx.attrs.protection_class,
        '  "lane_policy": "%s",' % _optional_label(ctx.attrs.lane_policy),
        '  "environment_stage": "%s",' % ctx.attrs.environment_stage,
        '  "admission_policy": "%s",' % _optional_label(ctx.attrs.admission_policy),
        '  "app_name": "%s",' % ctx.attrs.app_name,
        '  "container_port": %d,' % ctx.attrs.container_port,
        '  "health_path": "%s",' % ctx.attrs.health_path,
        '  "target_group": "%s"' % ctx.attrs.target_group,
        "}",
        "",
    ]
    ctx.actions.write(out, "\n".join(lines))
    return [DefaultInfo(default_output = out)]

deployment_target = rule(
    impl = _deployment_target_impl,
    attrs = {
        "provider": attrs.string(),
        "component": attrs.dep(),
        "component_kind": attrs.string(),
        "publisher": attrs.string(),
        "provisioner": attrs.string(default = ""),
        "protection_class": attrs.string(default = "shared_nonprod"),
        "lane_policy": attrs.option(attrs.dep(), default = None),
        "environment_stage": attrs.string(default = ""),
        "admission_policy": attrs.option(attrs.dep(), default = None),
        "app_name": attrs.string(default = ""),
        "container_port": attrs.int(default = 0),
        "health_path": attrs.string(default = ""),
        "target_group": attrs.string(default = ""),
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
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        if lane_policy == None:
            fail("protected/shared deployments must set lane_policy")
        if not environment_stage:
            fail("protected/shared deployments must set environment_stage")
        if admission_policy == None:
            fail("protected/shared deployments must set admission_policy")
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
        app_name = app_name,
        container_port = container_port,
        health_path = health_path,
        target_group = target_group,
        labels = labels + [
            "kind:deployment",
            "deployment:nixos-shared-host",
            "deployment-component:static-webapp",
        ],
        visibility = visibility,
    )
