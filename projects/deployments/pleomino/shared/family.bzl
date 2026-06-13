load("@viberoots//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment", "nixos_shared_host_static_webapp_deployment")
load("@viberoots//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")

_ACCOUNT_ID = "1b911846f80a89272c0dbaf44f5c810f"
_ZONE_ID = "9411ac5903acb1c2e29b3d4c04ef7e6f"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_CLOUDFLARE_SECRET_REF = "secret://deployments/pleomino/cloudflare_api_token"

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

def _cloudflare_stage(stage, admission_policy, protection_class, domain, prerequisite):
    prerequisites = [] if not prerequisite else [{"deployment_id": prerequisite, "mode": "ordering_only"}]
    return deployment_stage_delta(
        stage = stage,
        deployment_context = "pleomino-%s" % stage,
        admission_policy = "//projects/deployments/pleomino/shared:%s" % admission_policy,
        protection_class = protection_class,
        ingress_hostnames = [domain],
        secret_requirements = [_cloudflare_secret(step) for step in ["provision", "publish", "preview_cleanup"]],
        external_requirement_profiles = ["cloudflare_provider"],
        prerequisites = prerequisites,
        preview = {
            "target_derivation": "provider_managed_source_run",
            "isolation_class": "isolated",
            "identity_selector": "source_run",
            "cleanup_ttl": "7d",
            "smoke_target": "preview_url",
            "lock_scope": "shared",
        },
    )

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

def pleomino_cloudflare_deployment(name, stage, domain, admission_policy, protection_class, prerequisite, account = "", project = ""):
    if account:
        fail(
            "pleomino_cloudflare_deployment must not set account; provider_target.account comes from deployment context pleomino-%s" % stage,
        )
    if project:
        fail(
            "pleomino_cloudflare_deployment must not set project; provider_target.project comes from deployment context pleomino-%s" % stage,
        )
    cloudflare_pages_static_webapp_deployment(**compose_deployment_family_kwargs(
        _family_defaults(),
        _cloudflare_stage(stage, admission_policy, protection_class, domain, prerequisite),
        provider_args = {
            "name": name,
            "account": "",
            "account_id": _ACCOUNT_ID,
            "custom_domain": "",
            "custom_domain_zone_id": _ZONE_ID,
            "project": "",
        },
        include_provider_target = False,
    ))
