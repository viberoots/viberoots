#!/usr/bin/env zx-wrapper
import {
  redactInfisicalCredentialJson,
  redactInfisicalCredentialText,
  resolveInfisicalAccessToken,
  type InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";
import type { DeploymentInfisicalSelector } from "./deployment-secret-infisical-selectors";

export type InfisicalSecretRecord = DeploymentInfisicalSelector & {
  id?: string;
  reference?: string;
  version?: string;
  secretValue?: string;
  deleted?: boolean;
  revoked?: boolean;
  unavailable?: boolean;
};

function secretUrl(
  siteUrl: string,
  selector: DeploymentInfisicalSelector,
  value: boolean,
  version?: string,
) {
  const url = new URL(`/api/v3/secrets/raw/${encodeURIComponent(selector.secretName)}`, siteUrl);
  url.searchParams.set("workspaceId", selector.projectId);
  url.searchParams.set("environment", selector.environment);
  url.searchParams.set("secretPath", selector.secretPath);
  url.searchParams.set("type", "shared");
  url.searchParams.set("viewSecretValue", value ? "true" : "false");
  url.searchParams.set("expandSecretReferences", "false");
  url.searchParams.set("includeImports", "false");
  if (version) url.searchParams.set("secretVersion", version);
  return url;
}

function normalizedSecretBody(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.secret;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return body;
}

function stringField(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

async function readJson(response: Response, secrets: readonly string[]) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Infisical secret response was malformed JSON: ${response.status}`);
  }
}

export async function readInfisicalSecret(opts: {
  credential: InfisicalCredentialConfig;
  selector: DeploymentInfisicalSelector;
  viewSecretValue: boolean;
  version?: string;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalSecretRecord | undefined> {
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await resolveInfisicalAccessToken(opts.credential, { fetchImpl });
  const response = await fetchImpl(
    secretUrl(token.siteUrl, opts.selector, opts.viewSecretValue, opts.version),
    { headers: { Accept: "application/json", Authorization: `Bearer ${token.accessToken}` } },
  );
  if (response.status === 404) return undefined;
  const body = await readJson(response, [token.accessToken]);
  if (!response.ok) {
    throw new Error(
      `Infisical secret read failed: ${response.status} ${redactInfisicalCredentialText(
        JSON.stringify(redactInfisicalCredentialJson(body)),
        { secrets: [token.accessToken] },
      )}`,
    );
  }
  const secret = normalizedSecretBody(body);
  return {
    projectId: stringField(secret, ["projectId", "workspaceId"]) || opts.selector.projectId,
    environment: stringField(secret, ["environment"]) || opts.selector.environment,
    secretPath: stringField(secret, ["secretPath", "path"]) || opts.selector.secretPath,
    secretName: stringField(secret, ["secretName", "key", "name"]) || opts.selector.secretName,
    ...(stringField(secret, ["id", "_id", "secretId"])
      ? { id: stringField(secret, ["id", "_id", "secretId"]) }
      : {}),
    ...(stringField(secret, ["reference", "secretReference"])
      ? { reference: stringField(secret, ["reference", "secretReference"]) }
      : {}),
    ...(stringField(secret, ["version", "secretVersion", "versionId"])
      ? { version: stringField(secret, ["version", "secretVersion", "versionId"]) }
      : {}),
    ...(typeof secret.secretValue === "string" ? { secretValue: secret.secretValue } : {}),
    deleted: secret.deleted === true,
    revoked: secret.revoked === true,
    unavailable: secret.unavailable === true,
  };
}
