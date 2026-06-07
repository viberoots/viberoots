#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { readStringRecord } from "./deployment-graph-readers";

export type DeploymentInfisicalRuntimeConfig = {
  siteUrl: string;
  projectId: string;
  projectName?: string;
  projectSlug?: string;
  environment: string;
  secretPath?: string;
  secretPathPrefix?: string;
  machineIdentityClientIdEnv?: string;
  machineIdentityClientSecretEnv?: string;
  machineIdentityClientIdRef?: string;
  machineIdentityClientSecretRef?: string;
  machineIdentityClientIdFileName?: string;
  machineIdentityClientSecretFileName?: string;
  machineIdentityId?: string;
  preferredCredentialSource?: "machine_identity_universal_auth";
  accessTokenTtlSeconds?: string;
  accessTokenMaxUses?: string;
};

export function readInfisicalRuntime(
  node: GraphNode,
): DeploymentInfisicalRuntimeConfig | undefined {
  const runtime = readStringRecord(node, "infisical_runtime");
  if (Object.keys(runtime).length === 0) return undefined;
  const credentialSource =
    runtime.preferred_credential_source === "infisical_machine_identity_universal_auth"
      ? "machine_identity_universal_auth"
      : runtime.preferred_credential_source;
  return {
    siteUrl: runtime.site_url || "",
    projectId: runtime.project_id || "",
    ...(runtime.project_name ? { projectName: runtime.project_name } : {}),
    ...(runtime.project_slug ? { projectSlug: runtime.project_slug } : {}),
    environment: runtime.environment || "",
    ...(runtime.secret_path ? { secretPath: runtime.secret_path } : {}),
    ...(runtime.secret_path_prefix ? { secretPathPrefix: runtime.secret_path_prefix } : {}),
    ...(runtime.machine_identity_client_id_env
      ? { machineIdentityClientIdEnv: runtime.machine_identity_client_id_env }
      : {}),
    ...(runtime.machine_identity_client_secret_env
      ? { machineIdentityClientSecretEnv: runtime.machine_identity_client_secret_env }
      : {}),
    ...(runtime.machine_identity_client_id_ref
      ? { machineIdentityClientIdRef: runtime.machine_identity_client_id_ref }
      : {}),
    ...(runtime.machine_identity_client_secret_ref
      ? { machineIdentityClientSecretRef: runtime.machine_identity_client_secret_ref }
      : {}),
    ...(runtime.machine_identity_client_id_file_name
      ? { machineIdentityClientIdFileName: runtime.machine_identity_client_id_file_name }
      : {}),
    ...(runtime.machine_identity_client_secret_file_name
      ? { machineIdentityClientSecretFileName: runtime.machine_identity_client_secret_file_name }
      : {}),
    ...(runtime.machine_identity_id ? { machineIdentityId: runtime.machine_identity_id } : {}),
    ...(credentialSource ? { preferredCredentialSource: credentialSource } : {}),
    ...(runtime.access_token_ttl_seconds
      ? { accessTokenTtlSeconds: runtime.access_token_ttl_seconds }
      : {}),
    ...(runtime.access_token_max_uses ? { accessTokenMaxUses: runtime.access_token_max_uses } : {}),
  };
}
