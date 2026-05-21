load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment", "nixos_shared_host_static_webapp_deployment")
load("//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")

_ACCOUNT_ID = "1b911846f80a89272c0dbaf44f5c810f"
_ZONE_ID = "9411ac5903acb1c2e29b3d4c04ef7e6f"
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_pleomino_deployments"
_INFISICAL_PROJECT_NAME = "pleomino-deployments"
_INFISICAL_PROJECT_SLUG = "pleomino-deployments"
_INFISICAL_ENVIRONMENT_SLUGS = {
    "staging": "staging",
    "prod": "prod",
}
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_CLOUDFLARE_SECRET_REF = "secret://deployments/pleomino/cloudflare_api_token"
_INFISICAL_MACHINE_IDENTITY_IDS = {
    "staging": "identity_pleomino_staging_deploy",
    "prod": "identity_pleomino_prod_deploy",
}
_INFISICAL_MACHINE_IDENTITY_NAMES = {
    "staging": "pleomino-staging-deploy",
    "prod": "pleomino-prod-deploy",
}
_INFISICAL_CREDENTIAL_FILE_NAMES = {
    "staging": {
        "client_id": "pleomino-staging-infisical-client-id",
        "client_secret": "pleomino-staging-infisical-client-secret",
    },
    "prod": {
        "client_id": "pleomino-prod-infisical-client-id",
        "client_secret": "pleomino-prod-infisical-client-secret",
    },
}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {
        "client_id": "secret://deployments/pleomino/staging/infisical-client-id",
        "client_secret": "secret://deployments/pleomino/staging/infisical-client-secret",
    },
    "prod": {
        "client_id": "secret://deployments/pleomino/prod/infisical-client-id",
        "client_secret": "secret://deployments/pleomino/prod/infisical-client-secret",
    },
}

def _vault_runtime():
    return {
        "addr": "https://secrets.apps.kilty.io:8200",
        "oidc_issuer": "https://identity.apps.kilty.io/realms/deployments",
        "audience": "deployments-vault",
        "deployment_client_id": "deployment-runner",
        "service_account_client_id": "deployment-runner",
        "cli_public_client_id": "deployment-cli",
        "deployment_environment": "mini",
        "jwt_role": "deploy-pleomino-read",
        "pkce_callback_mode": "public_host",
        "pkce_callback_external_scheme": "https",
        "pkce_callback_external_host": "deploy-auth.apps.kilty.io",
        "pkce_callback_external_path": "/oidc/callback",
        "pkce_callback_bind_host": "127.0.0.1",
        "pkce_callback_bind_port": "7780",
        "pkce_callback_bind_path": "/oidc/callback",
    }

def _family_defaults():
    return deployment_family_defaults(
        component = "//projects/apps/pleomino:app",
        lane_policy = "//projects/deployments/pleomino/shared:lane",
    )

def _cloudflare_secret(step):
    return {
        "name": _INFISICAL_CLOUDFLARE_SECRET_NAME,
        "step": step,
        "contract_id": _INFISICAL_CLOUDFLARE_SECRET_REF,
        "required": "true",
    }

def _cloudflare_stage(stage, admission_policy, protection_class, account, project, domain, prerequisite):
    prerequisites = [] if not prerequisite else [{"deployment_id": prerequisite, "mode": "ordering_only"}]
    return deployment_stage_delta(
        stage = stage,
        admission_policy = "//projects/deployments/pleomino/shared:%s" % admission_policy,
        protection_class = protection_class,
        provider_target = {"account": account, "project": project, "custom_domain": domain},
        ingress_hostnames = [domain],
        secret_requirements = [_cloudflare_secret(step) for step in ["provision", "publish", "preview_cleanup"]],
        external_requirement_profiles = ["cloudflare_provider"],
        prerequisites = prerequisites,
        secret_backend = "infisical/default",
        infisical_runtime = _pleomino_infisical_runtime(stage),
        preview = {
            "target_derivation": "provider_managed_source_run",
            "isolation_class": "isolated",
            "identity_selector": "source_run",
            "cleanup_ttl": "7d",
            "smoke_target": "preview_url",
            "lock_scope": "shared",
        },
    )

def _pleomino_infisical_runtime(stage):
    env_prefix = "PLEOMINO_%s_INFISICAL" % stage.upper()
    return {
        "site_url": _INFISICAL_SITE_URL,
        "project_id": _INFISICAL_PROJECT_ID,
        "environment": _INFISICAL_ENVIRONMENT_SLUGS[stage],
        "secret_path": _INFISICAL_SECRET_PATH,
        "preferred_credential_source": "infisical_machine_identity_universal_auth",
        "machine_identity_client_id_env": "%s_CLIENT_ID" % env_prefix,
        "machine_identity_client_secret_env": "%s_CLIENT_SECRET" % env_prefix,
        "machine_identity_client_id_file_name": _INFISICAL_CREDENTIAL_FILE_NAMES[stage]["client_id"],
        "machine_identity_client_secret_file_name": _INFISICAL_CREDENTIAL_FILE_NAMES[stage]["client_secret"],
        "machine_identity_id": _INFISICAL_MACHINE_IDENTITY_IDS[stage],
    }

def pleomino_dev_deployment(name):
    nixos_shared_host_static_webapp_deployment(**compose_deployment_family_kwargs(
        _family_defaults(),
        deployment_stage_delta(
            stage = "dev",
            admission_policy = "//projects/deployments/pleomino/shared:dev_release",
            protection_class = "shared_nonprod",
            vault_runtime = _vault_runtime(),
            provider_target = {
                "host": "nixos-shared-host",
                "target_group": "default",
                "app_name": "pleomino",
                "deployment_target_identity": "nixos-shared-host:default:pleomino",
                "hostname": "pleomino.apps.kilty.io",
                "container_name": "pleomino",
                "shared_dev_target_identity": "nixos-shared-host:default:pleomino",
            },
        ),
        provider_args = {
            "name": name,
            "app_name": "pleomino",
            "target_group": "default",
            "container_port": 3000,
            "health_path": "/healthz",
        },
    ))

def pleomino_cloudflare_deployment(name, stage, account, project, domain, admission_policy, protection_class, prerequisite):
    cloudflare_pages_static_webapp_deployment(**compose_deployment_family_kwargs(
        _family_defaults(),
        _cloudflare_stage(stage, admission_policy, protection_class, account, project, domain, prerequisite),
        provider_args = {
            "name": name,
            "account": account,
            "account_id": _ACCOUNT_ID,
            "custom_domain": domain,
            "custom_domain_zone_id": _ZONE_ID,
            "project": project,
        },
        include_provider_target = False,
    ))
