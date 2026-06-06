#!/usr/bin/env zx-wrapper
import { DEPLOYMENT_AUTH_REDACTION, redactDeploymentAuthText } from "./deployment-auth-redaction";
import type { DeploymentInfisicalRuntimeConfig } from "./deployment-secret-metadata";
export type { DeploymentInfisicalRuntimeConfig } from "./deployment-secret-metadata";

export const INFISICAL_MACHINE_IDENTITY_UNIVERSAL_AUTH =
  "infisical_machine_identity_universal_auth";

export type InfisicalCredentialConfig =
  | {
      kind: "universal_auth";
      siteUrl: string;
      clientId: string;
      clientSecret: string;
    }
  | {
      kind: "access_token";
      siteUrl: string;
      accessToken: string;
      expiresAt?: string;
    };

export type InfisicalAccessToken = {
  siteUrl: string;
  accessToken: string;
  expiresAt?: string;
};

type CachedInfisicalToken = InfisicalAccessToken & {
  key: string;
  expiresAtMs?: number;
};

let cachedTokens = new Map<string, CachedInfisicalToken>();

function cacheKey(siteUrl: string, clientId: string): string {
  return `${siteUrl} identity:${clientId}`;
}

function redactInfisicalSecretText(value: unknown, secrets: readonly string[] = []): string {
  return redactDeploymentAuthText(value, { secrets });
}

export function redactInfisicalCredentialText(
  value: unknown,
  opts: { secrets?: readonly string[] } = {},
): string {
  return redactInfisicalSecretText(value, opts.secrets || []);
}

export function redactInfisicalCredentialJson<T>(
  value: T,
  opts: { secrets?: readonly string[] } = {},
): T {
  if (typeof value === "string") return redactInfisicalCredentialText(value, opts) as T;
  if (Array.isArray(value)) {
    return value.map((entry) => redactInfisicalCredentialJson(entry, opts)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /accessToken|clientSecret|secretValue|expandedReference|token/i.test(key)
        ? DEPLOYMENT_AUTH_REDACTION
        : redactInfisicalCredentialJson(entry, opts),
    ]),
  ) as T;
}

export function normalizeInfisicalSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("infisical site URL is required");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("infisical site URL must be an absolute http or https URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("infisical site URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("infisical site URL must not include credentials, query, or fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function loginUrl(siteUrl: string): URL {
  return new URL("/api/v1/auth/universal-auth/login", `${siteUrl}/`);
}

function usableCachedToken(
  key: string,
  nowMs: number,
  skewMs: number,
): CachedInfisicalToken | undefined {
  const token = cachedTokens.get(key);
  if (!token) return undefined;
  if (token.expiresAtMs === undefined || nowMs + skewMs < token.expiresAtMs) return token;
  cachedTokens.delete(key);
  return undefined;
}

function expiresAtFromResponse(nowMs: number, expiresIn: unknown): { iso?: string; ms?: number } {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return {};
  const ms = nowMs + expiresIn * 1000;
  return { iso: new Date(ms).toISOString(), ms };
}

async function readInfisicalLoginBody(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Infisical Universal Auth returned malformed JSON: ${response.status}`);
  }
}

async function loginWithUniversalAuth(
  config: Extract<InfisicalCredentialConfig, { kind: "universal_auth" }>,
  opts: { nowMs: number; fetchImpl: typeof fetch; skewMs: number },
): Promise<InfisicalAccessToken> {
  const siteUrl = normalizeInfisicalSiteUrl(config.siteUrl);
  const key = cacheKey(siteUrl, config.clientId);
  const cached = usableCachedToken(key, opts.nowMs, opts.skewMs);
  if (cached) return cached;
  const secrets = [config.clientSecret];
  const response = await opts.fetchImpl(loginUrl(siteUrl), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
  });
  const body = await readInfisicalLoginBody(response);
  if (!response.ok) {
    throw new Error(
      `Infisical Universal Auth failed: ${response.status} ${redactInfisicalSecretText(
        JSON.stringify(redactInfisicalCredentialJson(body)),
        secrets,
      )}`,
    );
  }
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const tokenType = typeof body.tokenType === "string" ? body.tokenType.trim() : "";
  const expiry = expiresAtFromResponse(opts.nowMs, body.expiresIn);
  if (!accessToken || tokenType !== "Bearer" || !expiry.iso || !expiry.ms) {
    throw new Error(
      `Infisical Universal Auth response missing accessToken, Bearer tokenType, or expiresIn: ${redactInfisicalSecretText(
        JSON.stringify(redactInfisicalCredentialJson(body)),
        [config.clientSecret, accessToken],
      )}`,
    );
  }
  cachedTokens.set(key, {
    key,
    siteUrl,
    accessToken,
    expiresAt: expiry.iso,
    expiresAtMs: expiry.ms,
  });
  return { siteUrl, accessToken, expiresAt: expiry.iso };
}

export async function resolveInfisicalAccessToken(
  config: InfisicalCredentialConfig,
  opts: { nowMs?: number; fetchImpl?: typeof fetch; expirySkewMs?: number } = {},
): Promise<InfisicalAccessToken> {
  const siteUrl = normalizeInfisicalSiteUrl(config.siteUrl);
  if (config.kind === "access_token") {
    if (config.expiresAt && Date.parse(config.expiresAt) <= (opts.nowMs ?? Date.now())) {
      throw new Error("Infisical in-memory access token is expired");
    }
    return {
      siteUrl,
      accessToken: config.accessToken,
      ...(config.expiresAt ? { expiresAt: config.expiresAt } : {}),
    };
  }
  return await loginWithUniversalAuth(
    { ...config, siteUrl },
    {
      nowMs: opts.nowMs ?? Date.now(),
      fetchImpl: opts.fetchImpl || fetch,
      skewMs: opts.expirySkewMs ?? 30_000,
    },
  );
}

function readEnv(env: NodeJS.ProcessEnv, name: string | undefined): string {
  return name ? String(env[name] || "").trim() : "";
}

export function rejectAmbientInfisicalCredentialEnv(env: NodeJS.ProcessEnv) {
  for (const name of [
    "INFISICAL_TOKEN",
    "INFISICAL_ACCESS_TOKEN",
    "INFISICAL_PERSONAL_TOKEN",
    "INFISICAL_SERVICE_TOKEN",
  ]) {
    if (readEnv(env, name)) {
      throw new Error(
        `ambient Infisical credential ${name} is not accepted; use reviewed infisical_runtime Universal Auth env names`,
      );
    }
  }
}

export function infisicalCredentialFromRuntime(opts: {
  runtime: DeploymentInfisicalRuntimeConfig;
  env?: NodeJS.ProcessEnv;
}): InfisicalCredentialConfig {
  const env = opts.env || process.env;
  rejectAmbientInfisicalCredentialEnv(env);
  if (opts.runtime.preferredCredentialSource !== "machine_identity_universal_auth") {
    throw new Error(
      "Infisical credential source must be infisical_machine_identity_universal_auth",
    );
  }
  const clientId = readEnv(env, opts.runtime.machineIdentityClientIdEnv);
  const clientSecret = readEnv(env, opts.runtime.machineIdentityClientSecretEnv);
  if (!clientId)
    throw new Error("Infisical Universal Auth client id environment variable is unset");
  if (!clientSecret) {
    throw new Error("Infisical Universal Auth client secret environment variable is unset");
  }
  return {
    kind: "universal_auth",
    siteUrl: opts.runtime.siteUrl,
    clientId,
    clientSecret,
  };
}

export function resetInfisicalCredentialCacheForTests() {
  cachedTokens = new Map();
}
