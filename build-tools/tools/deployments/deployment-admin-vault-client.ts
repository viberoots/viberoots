#!/usr/bin/env zx-wrapper
import type { DeploymentAdminVaultDesiredState } from "./deployment-admin-vault";

export type DeploymentAdminVaultLiveState = {
  config?: Record<string, unknown> | undefined;
  role?: Record<string, unknown> | undefined;
  policy?: string | undefined;
};

export type DeploymentAdminVaultDrift = {
  config: string[];
  policy: string[];
  role: string[];
};

export type VaultAdminCredential = {
  addr: string;
  token: string;
};

function sortedObject(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .filter((entry) => entry.length > 0)
      .sort();
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return sortedObject(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
    ),
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => entry === b[index]);
}

function sameStringRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  return JSON.stringify(sortedObject(a)) === JSON.stringify(sortedObject(b));
}

function trimPolicy(policy: string | undefined): string {
  return String(policy || "").trim();
}

async function vaultRequest<T>(
  credential: VaultAdminCredential,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data?: T | undefined }> {
  const base = credential.addr.endsWith("/") ? credential.addr : `${credential.addr}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);
  const response = await fetch(url, {
    ...(init || {}),
    headers: {
      Accept: "application/json",
      "X-Vault-Token": credential.token,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Vault admin request failed for ${url.pathname}: ${response.status}${body ? ` ${body}` : ""}`,
    );
  }
  if (response.status === 204) return { status: response.status };
  return { status: response.status, data: (await response.json()) as T };
}

export async function readDeploymentAdminVaultLiveState(
  credential: VaultAdminCredential,
  desired: DeploymentAdminVaultDesiredState,
): Promise<DeploymentAdminVaultLiveState> {
  const [config, role, policy] = await Promise.all([
    vaultRequest<{ data?: Record<string, unknown> }>(credential, "/v1/auth/jwt/config"),
    vaultRequest<{ data?: Record<string, unknown> }>(
      credential,
      `/v1/auth/jwt/role/${encodeURIComponent(desired.roleName)}`,
    ),
    vaultRequest<{ data?: { policy?: string } }>(
      credential,
      `/v1/sys/policies/acl/${encodeURIComponent(desired.policyName)}`,
    ),
  ]);
  return {
    ...(config.data?.data ? { config: config.data.data } : {}),
    ...(role.data?.data ? { role: role.data.data } : {}),
    ...(policy.data?.data?.policy ? { policy: String(policy.data.data.policy) } : {}),
  };
}

export function deploymentAdminVaultDrift(
  desired: DeploymentAdminVaultDesiredState,
  live: DeploymentAdminVaultLiveState,
): DeploymentAdminVaultDrift {
  const config: string[] = [];
  const role: string[] = [];
  const policy: string[] = [];
  if (String(live.config?.oidc_discovery_url || "") !== desired.config.oidc_discovery_url) {
    config.push("oidc_discovery_url");
  }
  if (String(live.config?.bound_issuer || "") !== desired.config.bound_issuer) {
    config.push("bound_issuer");
  }
  if (trimPolicy(live.policy) !== trimPolicy(desired.policyHcl)) {
    policy.push("policy");
  }
  if (String(live.role?.role_type || "") !== desired.role.role_type) role.push("role_type");
  if (String(live.role?.user_claim || "") !== desired.role.user_claim) role.push("user_claim");
  if (!sameStringArray(strings(live.role?.bound_audiences), desired.role.bound_audiences)) {
    role.push("bound_audiences");
  }
  if (!sameStringRecord(stringRecord(live.role?.bound_claims), desired.role.bound_claims)) {
    role.push("bound_claims");
  }
  if (!sameStringArray(strings(live.role?.token_policies), desired.role.token_policies)) {
    role.push("token_policies");
  }
  return { config, policy, role };
}

export function driftSummary(drift: DeploymentAdminVaultDrift): string[] {
  return [
    ...drift.config.map((field) => `config.${field}`),
    ...drift.policy.map((field) => `policy.${field}`),
    ...drift.role.map((field) => `role.${field}`),
  ];
}

export function deploymentAdminVaultInSync(drift: DeploymentAdminVaultDrift): boolean {
  return driftSummary(drift).length === 0;
}

export async function writeDeploymentAdminVaultState(
  credential: VaultAdminCredential,
  desired: DeploymentAdminVaultDesiredState,
) {
  await vaultRequest(credential, "/v1/auth/jwt/config", {
    method: "POST",
    body: JSON.stringify(desired.config),
  });
  await vaultRequest(credential, `/v1/sys/policies/acl/${encodeURIComponent(desired.policyName)}`, {
    method: "PUT",
    body: JSON.stringify({ policy: desired.policyHcl }),
  });
  await vaultRequest(credential, `/v1/auth/jwt/role/${encodeURIComponent(desired.roleName)}`, {
    method: "POST",
    body: JSON.stringify({
      ...desired.role,
      token_ttl: "30m",
      token_max_ttl: "2h",
    }),
  });
}
