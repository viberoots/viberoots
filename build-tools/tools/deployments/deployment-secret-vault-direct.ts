#!/usr/bin/env zx-wrapper
import {
  isDeploymentSecretAdmittedReference,
  type DeploymentSecretAdmittedReference,
  type DeploymentSecretContractBinding,
  type DeploymentSecretReference,
} from "./deployment-secretspec.ts";
import type { DeploymentSecretMaterial } from "./deployment-secret-runtime.ts";
import { resolveVaultClientCredential } from "./deployment-secret-vault-credentials.ts";

async function vaultEnv() {
  return await resolveVaultClientCredential();
}

function requireVaultContractPath(contractId: string): { mount: string; secretPath: string } {
  const prefix = "secret://";
  if (!contractId.startsWith(prefix))
    throw new Error(`unsupported Vault secret contract id: ${contractId}`);
  const secretPath = contractId.slice(prefix.length).trim().replace(/^\/+/, "");
  if (!secretPath) throw new Error(`invalid Vault secret contract id: ${contractId}`);
  return { mount: "secret", secretPath };
}

function vaultApiPath(contractId: string, kind: "data" | "metadata"): string {
  const { mount, secretPath } = requireVaultContractPath(contractId);
  return `/v1/${mount}/${kind}/${secretPath}`;
}

async function vaultRequest<T>(
  path: string,
  query?: URLSearchParams,
): Promise<{ status: number; data?: T }> {
  const env = await vaultEnv();
  const url = new URL(path, env.addr.endsWith("/") ? env.addr : `${env.addr}/`);
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    headers: { "X-Vault-Token": env.token, Accept: "application/json" },
  });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error(`Vault request failed for ${url.pathname}: ${response.status}`);
  return { status: response.status, data: (await response.json()) as T };
}

export async function resolveDirectVaultSecretReference(
  binding: DeploymentSecretContractBinding,
  targetScope: string,
): Promise<DeploymentSecretAdmittedReference | undefined> {
  const { mount, secretPath } = requireVaultContractPath(binding.contractId);
  const response = await vaultRequest<{ data?: { current_version?: number } }>(
    vaultApiPath(binding.contractId, "metadata"),
  );
  if (response.status === 404) return undefined;
  const version = String(response.data?.data?.current_version || "").trim();
  if (!version) throw new Error(`Vault metadata missing current version for ${binding.contractId}`);
  const backendRef = `${mount}/${secretPath}`;
  return {
    ...binding,
    targetScope,
    backendRef,
    selectorRef: `${backendRef}@${version}`,
    referenceId: `vault:${backendRef}@${version}`,
    resolvedVersion: version,
    resolvedAt: new Date().toISOString(),
    refreshMode: "none",
    credentialClass: "routine",
  };
}

export async function acquireDirectVaultSecretReference(
  binding: DeploymentSecretReference,
): Promise<DeploymentSecretMaterial> {
  const version = isDeploymentSecretAdmittedReference(binding)
    ? binding.resolvedVersion
    : undefined;
  const response = await vaultRequest<{
    data?: { data?: Record<string, unknown> };
  }>(
    vaultApiPath(binding.contractId, "data"),
    version ? new URLSearchParams({ version }) : undefined,
  );
  if (response.status === 404 || !response.data?.data?.data) {
    throw new Error(`required secret contract ${binding.contractId} is missing`);
  }
  const value = response.data.data.data.value;
  if (typeof value !== "string") {
    throw new Error(
      `required secret contract ${binding.contractId} does not expose string data.value`,
    );
  }
  return {
    binding,
    value,
    allowedSteps: [binding.step],
    targetScopes: [isDeploymentSecretAdmittedReference(binding) ? binding.targetScope : "*"],
    credentialClass: isDeploymentSecretAdmittedReference(binding)
      ? binding.credentialClass
      : "routine",
    refreshMode: isDeploymentSecretAdmittedReference(binding) ? binding.refreshMode : "none",
  };
}
