import {
  redactInfisicalCredentialJson,
  redactInfisicalCredentialText,
  resolveInfisicalAccessToken,
  type InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";
import type { DeploymentInfisicalSelector } from "./deployment-secret-infisical-selectors";

export type InfisicalWriteResult = {
  secretName: string;
  version?: string;
};

export async function writeInfisicalSecret(opts: {
  credential: InfisicalCredentialConfig;
  selector: DeploymentInfisicalSelector;
  secretValue: string;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalWriteResult> {
  const fetchImpl = opts.fetchImpl || fetch;
  const token = await resolveInfisicalAccessToken(opts.credential, { fetchImpl });
  const response = await fetchImpl(secretUrl(token.siteUrl, opts.selector), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.accessToken}`,
    },
    body: JSON.stringify({ ...opts.selector, type: "shared", secretValue: opts.secretValue }),
  });
  const text = await response.text();
  const body = parseBody(text, response.status);
  if (!response.ok) {
    throw new Error(
      `Infisical secret write failed: ${response.status} ${redactInfisicalCredentialText(
        JSON.stringify(redactInfisicalCredentialJson(body)),
        { secrets: [token.accessToken, opts.secretValue] },
      )}`,
    );
  }
  const secret = nested(body, "secret");
  return {
    secretName: stringField(secret, ["secretName", "name"]) || opts.selector.secretName,
    ...(stringField(secret, ["version", "secretVersion", "versionId"])
      ? { version: stringField(secret, ["version", "secretVersion", "versionId"]) }
      : {}),
  };
}

function secretUrl(siteUrl: string, selector: DeploymentInfisicalSelector): URL {
  const url = new URL(`/api/v4/secrets/${encodeURIComponent(selector.secretName)}`, siteUrl);
  url.searchParams.set("projectId", selector.projectId);
  url.searchParams.set("environment", selector.environment);
  url.searchParams.set("secretPath", selector.secretPath);
  url.searchParams.set("type", "shared");
  url.searchParams.set("viewSecretValue", "false");
  url.searchParams.set("expandSecretReferences", "false");
  url.searchParams.set("includeImports", "false");
  return url;
}

function parseBody(text: string, status: number): Record<string, unknown> {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Infisical secret write response was malformed JSON: ${status}`);
  }
}

function nested(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = body[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : body;
}

function stringField(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
