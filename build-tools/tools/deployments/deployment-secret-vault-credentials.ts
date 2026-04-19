#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";

export const VAULT_ADDR_ENV = "VAULT_ADDR";
export const VAULT_TOKEN_ENV = "VAULT_TOKEN";
export const VAULT_AUTH_METHOD_ENV = "BNX_VAULT_AUTH_METHOD";
export const VAULT_JWT_ROLE_ENV = "BNX_VAULT_JWT_ROLE";
export const VAULT_JWT_ENV = "BNX_VAULT_JWT";
export const VAULT_JWT_FILE_ENV = "BNX_VAULT_JWT_FILE";

type VaultJwtSource = { kind: "env"; value: string } | { kind: "file"; path: string };

export type VaultCredentialConfig =
  | {
      addr: string;
      method: "jwt";
      role: string;
      jwtSource: VaultJwtSource;
      loginPath: string;
    }
  | { addr: string; method: "token"; token: string };

let cachedCredential: { key: string; token: string } | undefined;

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return String(env[name] || "").trim();
}

function rejectPresent(env: NodeJS.ProcessEnv, names: string[], method: string) {
  const present = names.filter((name) => readEnv(env, name));
  if (present.length) {
    throw new Error(
      `ambiguous Vault auth configuration: ${VAULT_AUTH_METHOD_ENV}=${method} cannot be combined with ${present.join(", ")}`,
    );
  }
}

function jwtSource(env: NodeJS.ProcessEnv): VaultJwtSource {
  const inline = readEnv(env, VAULT_JWT_ENV);
  const filePath = readEnv(env, VAULT_JWT_FILE_ENV);
  if (inline && filePath) {
    throw new Error(
      `ambiguous Vault auth configuration: set only one of ${VAULT_JWT_ENV} or ${VAULT_JWT_FILE_ENV}`,
    );
  }
  if (inline) return { kind: "env", value: inline };
  if (filePath) return { kind: "file", path: filePath };
  throw new Error(`Vault JWT auth requires ${VAULT_JWT_ENV} or ${VAULT_JWT_FILE_ENV}`);
}

export function hasVaultCredentialConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return [
    VAULT_ADDR_ENV,
    VAULT_TOKEN_ENV,
    VAULT_AUTH_METHOD_ENV,
    VAULT_JWT_ROLE_ENV,
    VAULT_JWT_ENV,
    VAULT_JWT_FILE_ENV,
  ].some((name) => !!readEnv(env, name));
}

export function resolveVaultCredentialConfig(
  env: NodeJS.ProcessEnv = process.env,
): VaultCredentialConfig {
  const addr = readEnv(env, VAULT_ADDR_ENV);
  if (!addr) throw new Error(`Vault credential provider requires ${VAULT_ADDR_ENV}`);
  const method = readEnv(env, VAULT_AUTH_METHOD_ENV);
  if (!method) {
    throw new Error(
      `Vault credential provider requires ${VAULT_AUTH_METHOD_ENV}=jwt for production or ${VAULT_AUTH_METHOD_ENV}=token for explicit break-glass/test use`,
    );
  }
  if (method === "jwt") {
    rejectPresent(env, [VAULT_TOKEN_ENV], method);
    const role = readEnv(env, VAULT_JWT_ROLE_ENV);
    if (!role) throw new Error(`Vault JWT auth requires ${VAULT_JWT_ROLE_ENV}`);
    return { addr, method, role, jwtSource: jwtSource(env), loginPath: "/v1/auth/jwt/login" };
  }
  if (method === "token") {
    rejectPresent(env, [VAULT_JWT_ROLE_ENV, VAULT_JWT_ENV, VAULT_JWT_FILE_ENV], method);
    const token = readEnv(env, VAULT_TOKEN_ENV);
    if (!token) {
      throw new Error(
        `Vault token override requires ${VAULT_TOKEN_ENV} when ${VAULT_AUTH_METHOD_ENV}=token`,
      );
    }
    return { addr, method, token };
  }
  throw new Error(`unsupported Vault auth method ${method}; expected jwt or token`);
}

async function readJwt(source: VaultJwtSource): Promise<string> {
  if (source.kind === "env") return source.value;
  const jwt = (await fsp.readFile(source.path, "utf8")).trim();
  if (!jwt) throw new Error(`${VAULT_JWT_FILE_ENV} does not contain a JWT`);
  return jwt;
}

function credentialCacheKey(config: VaultCredentialConfig): string {
  if (config.method === "token") return `token:${config.addr}:${config.token}`;
  const source =
    config.jwtSource.kind === "env"
      ? `env:${config.jwtSource.value}`
      : `file:${config.jwtSource.path}`;
  return `jwt:${config.addr}:${config.role}:${source}`;
}

async function loginWithJwt(config: Extract<VaultCredentialConfig, { method: "jwt" }>) {
  const url = new URL(
    config.loginPath,
    config.addr.endsWith("/") ? config.addr : `${config.addr}/`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ role: config.role, jwt: await readJwt(config.jwtSource) }),
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
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ addr: string; token: string }> {
  const config = resolveVaultCredentialConfig(env);
  const key = credentialCacheKey(config);
  if (cachedCredential?.key === key) return { addr: config.addr, token: cachedCredential.token };
  const token = config.method === "token" ? config.token : await loginWithJwt(config);
  cachedCredential = { key, token };
  return { addr: config.addr, token };
}

export function resetVaultCredentialCacheForTests() {
  cachedCredential = undefined;
}
