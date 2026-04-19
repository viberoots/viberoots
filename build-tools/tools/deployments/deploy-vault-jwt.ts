#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { getArgvTokens, readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv.ts";
import { assertJwtClaims, decodeJwtPayload } from "./deploy-vault-jwt-claims.ts";

export type DeployVaultJwtOptions = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  out?: string;
  audience?: string;
  boundClaims?: Record<string, string>;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response was not a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`request failed for ${url}: ${response.status}`);
  return parseJsonObject(await response.json(), url);
}

export function parseExpectedClaimFlags(argv = getArgvTokens()): Record<string, string> {
  const claims: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] || "";
    const value =
      token === "--expect-claim" ? argv[++i] || "" : token.replace(/^--expect-claim=/, "");
    if (token !== "--expect-claim" && !token.startsWith("--expect-claim=")) continue;
    const eq = value.indexOf("=");
    if (eq <= 0) throw new Error("--expect-claim must use key=value");
    claims[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return claims;
}

async function discoverTokenEndpoint(issuer: string): Promise<string> {
  const discoveryUrl = `${trimTrailingSlash(issuer)}/.well-known/openid-configuration`;
  const discovery = await fetchJson(discoveryUrl);
  if (discovery.issuer !== trimTrailingSlash(issuer)) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  const tokenEndpoint =
    typeof discovery.token_endpoint === "string" ? discovery.token_endpoint : "";
  if (!tokenEndpoint) throw new Error("OIDC discovery response missing token_endpoint");
  return tokenEndpoint;
}

async function requestClientCredentialsToken(opts: DeployVaultJwtOptions): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const response = await fetch(await discoverTokenEndpoint(opts.issuer), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);
  const payload = parseJsonObject(await response.json(), "token endpoint");
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!token) throw new Error("token endpoint response missing access_token");
  return token;
}

async function writeTokenFile(out: string, token: string) {
  try {
    const stat = await fsp.lstat(out);
    if (!stat.isFile()) throw new Error("output path would overwrite a non-regular file");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fsp.writeFile(out, `${token}\n`, { mode: 0o600 });
  await fsp.chmod(out, 0o600).catch((error: any) => {
    if (error?.code !== "ENOSYS" && error?.code !== "EPERM") throw error;
  });
}

export async function mintDeployVaultJwt(opts: DeployVaultJwtOptions) {
  const issuer = trimTrailingSlash(opts.issuer);
  const token = await requestClientCredentialsToken({ ...opts, issuer });
  const claims = decodeJwtPayload(token);
  assertJwtClaims(claims, {
    issuer,
    audience: opts.audience,
    clientId: opts.clientId,
    boundClaims: opts.boundClaims || {},
  });
  if (opts.out) await writeTokenFile(opts.out, token);
  return { token, claims };
}

function required(name: string, value: string): string {
  if (!value.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}

export async function runDeployVaultJwtCli(argv = getArgvTokens(), env = process.env) {
  const secretEnv = required(
    "client-secret-env",
    readFlagStrFromTokens("client-secret-env", "", argv),
  );
  const clientSecret = String(env[secretEnv] || "").trim();
  if (!clientSecret) throw new Error(`client secret environment variable is unset: ${secretEnv}`);
  const result = await mintDeployVaultJwt({
    issuer: required("issuer", readFlagStrFromTokens("issuer", "", argv)),
    clientId: required("client-id", readFlagStrFromTokens("client-id", "", argv)),
    clientSecret,
    out: required("out", readFlagStrFromTokens("out", "", argv)),
    audience: readFlagStrFromTokens("audience", "", argv).trim() || undefined,
    boundClaims: parseExpectedClaimFlags(argv),
  });
  if (readFlagBoolFromTokens("inspect", argv) || readFlagBoolFromTokens("print-claims", argv)) {
    console.log(JSON.stringify(result.claims, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeployVaultJwtCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
