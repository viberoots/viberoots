def phase0_vault_runtime(role):
    return {
        "addr": "https://replace-me-vault.example.invalid:8200",
        "oidc_issuer": "https://replace-me-identity.example.invalid/realms/deployments",
        "audience": "deployments-vault",
        "deployment_client_id": "deployment-runner",
        "service_account_client_id": "deployment-runner",
        "cli_public_client_id": "deployment-cli",
        "deployment_environment": "phase0",
        "jwt_role": role,
    }

def phase0_secret(name, deployment, step):
    return {
        "name": name,
        "step": step,
        "contract_id": "secret://deployments/phase0/%s/%s" % (deployment, name),
        "required": "true",
        "source": "secret_runtime",
    }

def phase0_runtime(name, deployment, step = "publish"):
    return {
        "name": name,
        "step": step,
        "contract_id": "runtime://deployments/phase0/%s/%s" % (deployment, name),
        "required": "true",
    }

def phase0_smoke(url, path = "/healthz", runner_class = "http_10m"):
    return {
        "runner": "http",
        "runner_class": runner_class,
        "url": url,
        "path": path,
        "expected_status": "200",
    }

def phase0_stack_target(deployment, stage):
    return {
        "stack_identity": "phase0/%s/%s" % (deployment, stage),
        "state_backend_identity": "s3://replace-me-phase0-state/%s/%s" % (stage, deployment),
        "allowed_environment_differences": "stack_identity,state_backend_identity",
    }
