#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type { DeploymentVaultRuntimeConfig } from "./deployment-vault-runtime-types.ts";
import { readStringRecord } from "./deployment-graph-readers.ts";

export function readVaultRuntimeConfig(node: GraphNode): DeploymentVaultRuntimeConfig | undefined {
  const raw = readStringRecord(node, "vault_runtime");
  if (Object.keys(raw).length === 0) return undefined;
  return {
    ...(raw.addr ? { addr: raw.addr } : {}),
    ...(raw.oidc_issuer ? { oidcIssuer: raw.oidc_issuer } : {}),
    ...(raw.audience ? { audience: raw.audience } : {}),
    ...(raw.deployment_client_id ? { deploymentClientId: raw.deployment_client_id } : {}),
    ...(raw.deployment_environment ? { deploymentEnvironment: raw.deployment_environment } : {}),
    ...(raw.jwt_role ? { roleName: raw.jwt_role } : {}),
    ...(raw.jwt_file ? { jwtFile: raw.jwt_file } : {}),
    ...(raw.client_secret_env ? { clientSecretEnv: raw.client_secret_env } : {}),
  };
}
