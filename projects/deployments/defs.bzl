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
        "app_name": attrs.string(default = ""),
        "container_port": attrs.int(default = 0),
        "health_path": attrs.string(default = ""),
        "target_group": attrs.string(default = ""),
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
        labels = [],
        visibility = ["PUBLIC"]):
    deployment_target(
        name = name,
        provider = "nixos-shared-host",
        component = component,
        component_kind = "static-webapp",
        publisher = publisher,
        provisioner = provisioner,
        protection_class = protection_class,
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
