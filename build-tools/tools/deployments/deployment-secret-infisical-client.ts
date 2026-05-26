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

export type InfisicalProjectRecord = {
  id: string;
  name?: string;
};

export type InfisicalEnvironmentRecord = {
  slug: string;
  name?: string;
};

export type InfisicalProjectAccessRecord = {
  available: boolean;
  access?: boolean;
  permissions?: string[];
  evidence?: string;
};

function secretUrl(
  siteUrl: string,
  selector: DeploymentInfisicalSelector,
  value: boolean,
  version?: string,
) {
  const url = new URL(`/api/v4/secrets/${encodeURIComponent(selector.secretName)}`, siteUrl);
  url.searchParams.set("projectId", selector.projectId);
  url.searchParams.set("environment", selector.environment);
  url.searchParams.set("secretPath", selector.secretPath);
  url.searchParams.set("type", "shared");
  url.searchParams.set("viewSecretValue", value ? "true" : "false");
  url.searchParams.set("expandSecretReferences", "false");
  url.searchParams.set("includeImports", "false");
  if (version) url.searchParams.set("version", version);
  return url;
}

function normalizedSecretBody(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.secret;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return body;
}

function normalizedNestedBody(
  body: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  for (const key of keys) {
    const nested = body[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
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

function nestedStringField(
  body: Record<string, unknown>,
  key: string,
  nestedKeys: string[],
): string | undefined {
  const nested = body[key];
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  return stringField(nested as Record<string, unknown>, nestedKeys);
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
    projectId:
      stringField(secret, ["projectId", "workspaceId"]) ||
      nestedStringField(secret, "workspace", ["id", "_id", "workspaceId"]) ||
      "",
    environment: stringField(secret, ["environment"]) || "",
    secretPath: stringField(secret, ["secretPath", "path"]) || "",
    secretName: stringField(secret, ["secretName", "secretKey", "key", "name"]) || "",
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

export async function readInfisicalProject(opts: {
  credential: InfisicalCredentialConfig;
  projectId: string;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalProjectRecord | undefined> {
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await resolveInfisicalAccessToken(opts.credential, { fetchImpl });
  const response = await fetchImpl(
    new URL(`/api/v1/workspace/${encodeURIComponent(opts.projectId)}`, token.siteUrl),
    { headers: { Accept: "application/json", Authorization: `Bearer ${token.accessToken}` } },
  );
  if (response.status === 404) return undefined;
  const body = await readJson(response, [token.accessToken]);
  if (!response.ok) throw new Error(`Infisical project read failed: ${response.status}`);
  const project = normalizedNestedBody(body, ["workspace", "project"]);
  return {
    id: stringField(project, ["id", "_id", "workspaceId"]) || opts.projectId,
    ...(stringField(project, ["name", "projectName"])
      ? { name: stringField(project, ["name", "projectName"]) }
      : {}),
  };
}

export async function readInfisicalEnvironment(opts: {
  credential: InfisicalCredentialConfig;
  projectId: string;
  environment: string;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalEnvironmentRecord | undefined> {
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await resolveInfisicalAccessToken(opts.credential, { fetchImpl });
  const url = new URL(
    `/api/v1/workspace/${encodeURIComponent(opts.projectId)}/environments/${encodeURIComponent(opts.environment)}`,
    token.siteUrl,
  );
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token.accessToken}` },
  });
  if (response.status === 404) return undefined;
  const body = await readJson(response, [token.accessToken]);
  if (!response.ok) throw new Error(`Infisical environment read failed: ${response.status}`);
  const environment = normalizedNestedBody(body, ["environment"]);
  return {
    slug: stringField(environment, ["slug", "environment", "name"]) || opts.environment,
    ...(stringField(environment, ["name"]) ? { name: stringField(environment, ["name"]) } : {}),
  };
}

export async function readInfisicalMachineIdentityProjectAccess(opts: {
  credential: InfisicalCredentialConfig;
  projectId: string;
  machineIdentityId: string;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalProjectAccessRecord | undefined> {
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await resolveInfisicalAccessToken(opts.credential, { fetchImpl });
  const url = new URL(
    `/api/v1/workspace/${encodeURIComponent(opts.projectId)}/machine-identities/${encodeURIComponent(
      opts.machineIdentityId,
    )}/project-access`,
    token.siteUrl,
  );
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token.accessToken}` },
  });
  if (response.status === 404) return undefined;
  if (response.status === 501) {
    return { available: false, evidence: "infisical project-access evidence API unsupported" };
  }
  const body = await readJson(response, [token.accessToken]);
  if (!response.ok) {
    throw new Error(`Infisical machine identity project access read failed: ${response.status}`);
  }
  const access = normalizedNestedBody(body, ["access", "projectAccess"]);
  const permissions = Array.isArray(access.permissions)
    ? access.permissions.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    available: true,
    access: access.access === true || access.hasAccess === true,
    ...(permissions ? { permissions } : {}),
    ...(stringField(access, ["role", "membership", "evidence"])
      ? { evidence: stringField(access, ["role", "membership", "evidence"]) }
      : {}),
  };
}
