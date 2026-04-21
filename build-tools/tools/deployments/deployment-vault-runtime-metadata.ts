#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type { DeploymentVaultRuntimeConfig } from "./deployment-vault-runtime-types.ts";
import { readStringRecord } from "./deployment-graph-readers.ts";
import { normalizeCredentialSource } from "./deployment-credential-source-selection.ts";
import { readMetadataPkceCallbackProfile } from "./deployment-pkce-callback-profile.ts";

export function readVaultRuntimeConfig(node: GraphNode): DeploymentVaultRuntimeConfig | undefined {
  const raw = readStringRecord(node, "vault_runtime");
  if (Object.keys(raw).length === 0) return undefined;
  const pkceCallback = readMetadataPkceCallbackProfile(raw);
  return {
    ...(raw.addr ? { addr: raw.addr } : {}),
    ...(raw.oidc_issuer ? { oidcIssuer: raw.oidc_issuer } : {}),
    ...(raw.audience ? { audience: raw.audience } : {}),
    ...(raw.deployment_client_id ? { deploymentClientId: raw.deployment_client_id } : {}),
    ...(raw.cli_public_client_id ? { cliPublicClientId: raw.cli_public_client_id } : {}),
    ...(raw.service_account_client_id
      ? { serviceAccountClientId: raw.service_account_client_id }
      : {}),
    ...(raw.deployment_environment ? { deploymentEnvironment: raw.deployment_environment } : {}),
    ...(raw.jwt_role ? { roleName: raw.jwt_role } : {}),
    ...(raw.jwt_file ? { jwtFile: raw.jwt_file } : {}),
    ...(raw.client_secret_env ? { clientSecretEnv: raw.client_secret_env } : {}),
    ...(raw.preferred_credential_source
      ? { preferredCredentialSource: normalizeCredentialSource(raw.preferred_credential_source) }
      : {}),
    ...(raw.jenkins_client_secret_env
      ? { jenkinsClientSecretEnv: raw.jenkins_client_secret_env }
      : {}),
    ...(raw.external_oidc_token_env ? { externalOidcTokenEnv: raw.external_oidc_token_env } : {}),
    ...(raw.required_human_claim ? { requiredHumanClaim: raw.required_human_claim } : {}),
    ...(raw.required_human_claim_value
      ? { requiredHumanClaimValue: raw.required_human_claim_value }
      : {}),
    ...(pkceCallback ? { pkceCallback } : {}),
  };
}
