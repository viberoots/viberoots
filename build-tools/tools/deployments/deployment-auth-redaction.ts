#!/usr/bin/env zx-wrapper

export const DEPLOYMENT_AUTH_REDACTION = "[redacted:deployment-auth-secret]";

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const VAULT_TOKEN_PATTERN = /\b(?:hvs|hvb|s)\.[A-Za-z0-9_-]{12,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[^,\s)]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(access_token|accessToken|refresh_token|refreshToken|id_token|idToken|client_secret|clientSecret|code_verifier|codeVerifier|device_code|deviceCode|user_code|userCode|personal_token|personalToken|service_token|serviceToken|secret_value|secretValue|expanded_reference|expandedReference|code)=([^&\s"']+)/gi;
const SECRET_JSON_FIELD_PATTERN =
  /"(access_token|accessToken|refresh_token|refreshToken|id_token|idToken|client_secret|clientSecret|code_verifier|codeVerifier|device_code|deviceCode|user_code|userCode|personal_token|personalToken|service_token|serviceToken|secret_value|secretValue|expanded_reference|expandedReference|code|vault_token|vaultToken|vault_jwt|vaultJwt|jenkins_secret|jenkinsSecret)"\s*:\s*"[^"]*"/gi;
const STAGED_ARTIFACT_PATH_PATTERN = /\/[^\s"']*\.deploy-artifacts\/[^\s"']+/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactKnownSecrets(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.trim().length > 0)
    .reduce(
      (current, secret) =>
        current.replace(new RegExp(escapeRegExp(secret), "g"), DEPLOYMENT_AUTH_REDACTION),
      text,
    );
}

export function redactDeploymentAuthText(
  value: unknown,
  opts: { secrets?: readonly string[] } = {},
): string {
  return redactKnownSecrets(String(value ?? ""), opts.secrets || [])
    .replace(JWT_PATTERN, DEPLOYMENT_AUTH_REDACTION)
    .replace(VAULT_TOKEN_PATTERN, DEPLOYMENT_AUTH_REDACTION)
    .replace(BEARER_PATTERN, `Bearer ${DEPLOYMENT_AUTH_REDACTION}`)
    .replace(STAGED_ARTIFACT_PATH_PATTERN, "[redacted:staged-artifact-path]")
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key) => `${key}=${DEPLOYMENT_AUTH_REDACTION}`)
    .replace(SECRET_JSON_FIELD_PATTERN, (_match, key) => `"${key}":"${DEPLOYMENT_AUTH_REDACTION}"`);
}

export function redactDeploymentAuthJson<T>(
  value: T,
  opts: { secrets?: readonly string[] } = {},
): T {
  if (typeof value === "string") return redactDeploymentAuthText(value, opts) as T;
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeploymentAuthJson(entry, opts)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactDeploymentAuthJson(entry, opts)]),
  ) as T;
}
