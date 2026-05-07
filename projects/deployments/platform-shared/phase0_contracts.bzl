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

def phase0_readiness_secrets():
    return [
        _phase0_readiness_secret("ragie-readiness"),
        _phase0_readiness_secret("tenant-leak-readiness"),
        _phase0_readiness_secret("workos-mcp-readiness"),
        _phase0_readiness_secret("connect-readiness"),
        _phase0_readiness_secret("github-readiness"),
    ]

def _phase0_readiness_secret(name):
    return {
        "name": name,
        "step": "readiness",
        "contract_id": _phase0_readiness_contract(name),
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

def phase0_readiness_gates(required_access = ""):
    clients = ["claude", "chatgpt", "cursor"]
    connect_sources = ["drive", "notion", "slack"]
    scoped_sources = ["drive", "notion", "slack", "github"]
    denial_policies = ["connect_allow_github_deny", "connect_deny_github_allow", "deny_all"]
    gates = [
        _phase0_gate("phase0/ragie-acl", "ragie_acl_semantics", required_access),
        _phase0_gate("phase0/tenant-leak", "tenant_leak_check", required_access),
        _phase0_gate("phase0/fetch-full-document-grant", "fetch_full_document_grant_lifecycle", required_access),
    ]
    gates += [_phase0_gate("phase0/workos-mcp-auth/%s" % client, "workos_mcp_auth", required_access, client = client) for client in clients]
    gates += [_phase0_gate("phase0/connect-oauth/%s" % source, "connect_oauth_flow", source = source) for source in connect_sources]
    gates += [_phase0_gate("phase0/scoped-source/%s" % source, "scoped_source_enforcement", source = source) for source in scoped_sources]
    gates += [
        _phase0_gate("phase0/connect-metadata", "connect_metadata_shape", source = "connect"),
        _phase0_gate("phase0/connect-source-update", "connect_source_update", policy = "window_a_or_paused_after_import"),
        _phase0_gate("phase0/connect-branding", "connect_branding_observation", "connector_demo", source = "connect"),
        _phase0_gate("phase0/connect-acl-review", "connect_acl_review", source = "connect"),
        _phase0_gate("phase0/connect-limitations/slack", "connect_limitation_decision", "connector_demo", source = "slack", policy = "single_channel"),
        _phase0_gate("phase0/connect-limitations/notion", "connect_limitation_decision", "connector_demo", source = "notion", policy = "workspace_token"),
        _phase0_gate("phase0/github-install", "github_selected_repository_install", source = "github"),
        _phase0_gate("phase0/github-permissions", "github_permissions", source = "github"),
        _phase0_gate("phase0/github-token-non-persistence", "github_token_hygiene", source = "github", policy = "token_non_persistence"),
        _phase0_gate("phase0/github-hygiene", "github_token_hygiene", source = "github", policy = "hygiene"),
        _phase0_gate("phase0/github-refresh", "github_refresh_semantics", source = "github"),
        _phase0_gate("phase0/github-retrieval-bakeoff", "github_retrieval_bakeoff", "connector_demo", source = "github"),
    ]
    gates += [
        _phase0_gate(
            "phase0/external-fetch-denial/%s/%s" % (source, policy),
            "external_source_fetch_full_document_denial",
            source = source,
            policy = policy,
        )
        for source in scoped_sources
        for policy in denial_policies
    ]
    return gates

def _phase0_gate(name, gate_type, access = "connector_demo,connector_internal", source = "", client = "", policy = ""):
    credential = _phase0_gate_credential(gate_type, source)
    return {
        "name": name,
        "type": gate_type,
        "required_for": "deploy,provision_only",
        "required_access": access,
        "gate_version": "phase0-2026-05",
        "source": source,
        "client": client,
        "policy_combination": policy,
        "credential_contract_id": _phase0_readiness_contract(credential),
        "credential_source": "secret_runtime",
        "secret_runtime_step": "readiness",
    }

def _phase0_readiness_contract(name):
    return "secret://deployments/phase0/readiness/%s" % name

def _phase0_gate_credential(gate_type, source):
    if gate_type == "ragie_acl_semantics":
        return "ragie-readiness"
    if gate_type == "tenant_leak_check":
        return "tenant-leak-readiness"
    if gate_type == "workos_mcp_auth":
        return "workos-mcp-readiness"
    if source == "github" or gate_type.startswith("github_"):
        return "github-readiness"
    return "connect-readiness"
