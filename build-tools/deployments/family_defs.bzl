_FAMILY_DEFAULT_FIELDS = [
    "component",
    "lane_policy",
]

_STAGE_COMPOSED_FIELDS = [
    "admission_policy",
    "environment_stage",
    "external_requirement_profiles",
    "ingress_hostnames",
    "prerequisites",
    "protection_class",
    "provider_target",
    "resource_sizing",
    "runtime_config_requirements",
    "secret_requirements",
    "secret_backend",
    "secret_backend_profile",
    "infisical_runtime",
    "infisical_secret_mappings",
    "smoke",
    "smoke_exception",
    "preview",
    "rollout_policy",
    "vault_runtime",
]

_STAGE_DELTA_FIELDS = _STAGE_COMPOSED_FIELDS

def _forbid_keys(values, keys, source, owner):
    for key in keys:
        if key in values:
            fail("%s must not set %s; it comes from %s" % (source, key, owner))

def _is_present(value):
    return value != None and value != [] and value != {}

def _fact_value(fact, composed, provider_target):
    prefix = "provider_target."
    if fact.startswith(prefix):
        key = fact[len(prefix):]
        if key in provider_target:
            return provider_target[key]
        return composed.get(key)
    return composed.get(fact)

def _validate_provider_native_facts(facts, composed, provider_target):
    for fact, expected in facts.items():
        actual = _fact_value(fact, composed, provider_target)
        if actual != expected:
            fail("provider-native %s %s contradicts Buck metadata %s" % (fact, expected, actual))

def _validate_provider_target_args(provider_target, composed):
    for key, expected in provider_target.items():
        if key in composed and composed[key] != expected:
            fail("provider_args %s %s contradicts stage provider_target.%s %s" % (
                key,
                composed[key],
                key,
                expected,
            ))

def deployment_family_defaults(
        component,
        lane_policy,
        vault_runtime = {},
        external_requirement_profiles = [],
        runtime_config_requirements = [],
        labels = [],
        **kwargs):
    _forbid_keys(kwargs, _STAGE_DELTA_FIELDS, "deployment_family_defaults", "stage deltas")
    defaults = {
        "component": component,
        "lane_policy": lane_policy,
        "vault_runtime": vault_runtime,
        "external_requirement_profiles": external_requirement_profiles,
        "runtime_config_requirements": runtime_config_requirements,
        "labels": labels,
    }
    defaults.update(kwargs)
    return defaults

def deployment_stage_delta(
        stage,
        admission_policy,
        protection_class,
        provider_target = {},
        prerequisites = [],
        secret_requirements = [],
        runtime_config_requirements = [],
        external_requirement_profiles = [],
        vault_runtime = None,
        secret_backend = None,
        secret_backend_profile = None,
        infisical_runtime = None,
        infisical_secret_mappings = None,
        smoke = None,
        smoke_exception = None,
        preview = None,
        rollout_policy = None,
        ingress_hostnames = [],
        resource_sizing = {},
        provider_native_facts = {}):
    return {
        "environment_stage": stage,
        "admission_policy": admission_policy,
        "protection_class": protection_class,
        "provider_target": provider_target,
        "prerequisites": prerequisites,
        "secret_requirements": secret_requirements,
        "runtime_config_requirements": runtime_config_requirements,
        "external_requirement_profiles": external_requirement_profiles,
        "vault_runtime": vault_runtime,
        "secret_backend": secret_backend,
        "secret_backend_profile": secret_backend_profile,
        "infisical_runtime": infisical_runtime,
        "infisical_secret_mappings": infisical_secret_mappings,
        "smoke": smoke,
        "smoke_exception": smoke_exception,
        "preview": preview,
        "rollout_policy": rollout_policy,
        "ingress_hostnames": ingress_hostnames,
        "resource_sizing": resource_sizing,
        "provider_native_facts": provider_native_facts,
    }

def compose_deployment_family_kwargs(
        family_defaults,
        stage_delta,
        provider_args = {},
        include_provider_target = True):
    _forbid_keys(stage_delta, _FAMILY_DEFAULT_FIELDS, "deployment_stage_delta", "family defaults")
    _forbid_keys(provider_args, _FAMILY_DEFAULT_FIELDS, "provider_args", "family defaults")
    _forbid_keys(provider_args, _STAGE_DELTA_FIELDS, "provider_args", "deployment_stage_delta")
    composed = dict(family_defaults)
    composed.update(provider_args)
    for field in _STAGE_COMPOSED_FIELDS:
        if field == "provider_target" and not include_provider_target:
            continue
        value = stage_delta.get(field)
        if _is_present(value):
            composed[field] = value
    provider_target = dict(stage_delta.get("provider_target", {}))
    _validate_provider_target_args(provider_target, composed)
    _validate_provider_native_facts(
        stage_delta.get("provider_native_facts", {}),
        composed,
        provider_target,
    )
    return composed
