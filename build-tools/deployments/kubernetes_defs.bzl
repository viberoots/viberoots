def kubernetes_service_deployment(
        deployment_target,
        require_shared_policy,
        name,
        component,
        cluster,
        namespace,
        release,
        service_kind = "web",
        ingress_mode = "",
        health_path = "/healthz",
        smoke = None,
        smoke_exception = None,
        publisher = "helm-release",
        publisher_config = "helm/values.yaml",
        provisioner = "",
        provisioner_config = "",
        provider_target = {},
        protection_class = "shared_nonprod",
        lane_policy = None,
        environment_stage = "",
        admission_policy = None,
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        external_requirement_profiles = [],
        vault_runtime = {},
        secret_backend = "",
        infisical_runtime = {},
        infisical_secret_mappings = {},
        migration_bundle = None,
        labels = [],
        visibility = ["PUBLIC"]):
    if protection_class != "local_only":
        require_shared_policy(lane_policy, environment_stage, admission_policy)
    reserved_provider_target_keys = {
        "cluster": cluster,
        "namespace": namespace,
        "release": release,
        "id": "{}/{}/{}".format(cluster, namespace, release),
        "provider_target_identity": "kubernetes:{}/{}/{}".format(cluster, namespace, release),
        "service_kind": service_kind,
        "ingress_mode": ingress_mode,
        "health_path": health_path,
    }
    for key in reserved_provider_target_keys:
        if key in provider_target:
            fail(
                (
                    "kubernetes_service_deployment provider_target cannot override {}; set the " +
                    "top-level Kubernetes deployment argument instead"
                ).format(key),
            )
    effective_ingress_mode = ingress_mode
    if not effective_ingress_mode:
        effective_ingress_mode = "none" if service_kind == "worker" else "public"
    base_provider_target = {
        "cluster": cluster,
        "namespace": namespace,
        "release": release,
        "service_kind": service_kind,
        "ingress_mode": effective_ingress_mode,
        "health_path": health_path,
    }
    base_provider_target.update(provider_target)
    deployment_target(
        name = name,
        provider = "kubernetes",
        component = component,
        component_kind = "service",
        publisher = publisher,
        publisher_config = publisher_config,
        provisioner = provisioner,
        provisioner_config = provisioner_config,
        protection_class = protection_class,
        lane_policy = lane_policy,
        environment_stage = environment_stage,
        admission_policy = admission_policy,
        components = [{
            "id": "default",
            "kind": "service",
            "target": component,
        }],
        provider_target = base_provider_target,
        smoke = smoke or {},
        smoke_exception = smoke_exception or {},
        prerequisites = prerequisites,
        secret_requirements = secret_requirements,
        runtime_config_requirements = runtime_config_requirements,
        external_requirement_profiles = external_requirement_profiles,
        vault_runtime = vault_runtime,
        secret_backend = secret_backend,
        infisical_runtime = infisical_runtime,
        infisical_secret_mappings = infisical_secret_mappings,
        migration_bundle = migration_bundle,
        labels = labels + [
            "kind:deployment",
            "deployment:kubernetes",
            "deployment-component:service",
        ],
        visibility = visibility,
    )
