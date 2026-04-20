#!/usr/bin/env zx-wrapper

export const VAULT_ADDR_ENV = "VAULT_ADDR";
export const VAULT_TOKEN_ENV = "VAULT_TOKEN";
export const VAULT_AUTH_METHOD_ENV = "BNX_VAULT_AUTH_METHOD";
export const VAULT_JWT_ROLE_ENV = "BNX_VAULT_JWT_ROLE";
export const VAULT_JWT_ENV = "BNX_VAULT_JWT";
export const VAULT_JWT_FILE_ENV = "BNX_VAULT_JWT_FILE";

export type VaultCredentialConfig =
  | {
      kind: "jwt";
      addr: string;
      role: string;
      workloadJwt: string;
      loginPath?: string;
    }
  | { kind: "token"; addr: string; token: string };

let cachedCredential: { key: string; token: string } | undefined;

function credentialCacheKey(config: VaultCredentialConfig): string {
  if (config.kind === "token") return `token:${config.addr}:${config.token}`;
  return `jwt:${config.addr}:${config.role}:${config.workloadJwt}`;
}

function vaultUrl(config: Extract<VaultCredentialConfig, { kind: "jwt" }>) {
  const base = config.addr.endsWith("/") ? config.addr : `${config.addr}/`;
  return new URL(config.loginPath || "/v1/auth/jwt/login", base);
}

async function loginWithJwt(config: Extract<VaultCredentialConfig, { kind: "jwt" }>) {
  const response = await fetch(vaultUrl(config), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ role: config.role, jwt: config.workloadJwt }),
  });
  if (!response.ok) {
    throw new Error(
      `Vault JWT auth failed for role ${config.role}: ${response.status}; check expired JWT, audience, issuer, and claim bindings`,
    );
  }
  const data = (await response.json()) as { auth?: { client_token?: unknown } };
  const token = typeof data.auth?.client_token === "string" ? data.auth.client_token.trim() : "";
  if (!token) throw new Error("Vault JWT auth response missing auth.client_token");
  return token;
}

export async function resolveVaultClientCredential(
  config: VaultCredentialConfig,
): Promise<{ addr: string; token: string }> {
  const key = credentialCacheKey(config);
  if (cachedCredential?.key === key) return { addr: config.addr, token: cachedCredential.token };
  const token = config.kind === "token" ? config.token : await loginWithJwt(config);
  cachedCredential = { key, token };
  return { addr: config.addr, token };
}

export function resetVaultCredentialCacheForTests() {
  cachedCredential = undefined;
}
