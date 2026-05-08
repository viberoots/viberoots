def _github_app_requirement(name, step, contract_id, source):
    return {
        "name": name,
        "step": step,
        "contract_id": contract_id,
        "required": "true",
        "source": source,
    }

def github_app_requirements(
        deployment_id,
        step = "publish",
        webhooks = False,
        callback_config = False,
        webhook_config = False,
        contract_prefix = ""):
    prefix = contract_prefix if contract_prefix else "deployments/%s/github" % deployment_id
    secret_requirements = [
        _github_app_requirement(
            "github_app_private_key",
            step,
            "secret://%s/app_private_key" % prefix,
            "secret_runtime",
        ),
    ]
    runtime_config_requirements = [
        _github_app_requirement(
            "github_app_id",
            step,
            "runtime://%s/app_id" % prefix,
            "runtime_config",
        ),
    ]
    if webhooks:
        secret_requirements.append(_github_app_requirement(
            "github_webhook_secret",
            step,
            "secret://%s/webhook_secret" % prefix,
            "secret_runtime",
        ))
    if callback_config:
        runtime_config_requirements.append(_github_app_requirement(
            "github_callback_url",
            step,
            "runtime://%s/callback_url" % prefix,
            "runtime_config",
        ))
    if webhook_config:
        runtime_config_requirements.append(_github_app_requirement(
            "github_webhook_url",
            step,
            "runtime://%s/webhook_url" % prefix,
            "runtime_config",
        ))
    return {
        "external_requirement_profiles": ["github_app"],
        "secret_requirements": secret_requirements,
        "runtime_config_requirements": runtime_config_requirements,
    }
