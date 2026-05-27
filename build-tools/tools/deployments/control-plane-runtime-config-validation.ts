import * as fsp from "node:fs/promises";
import path from "node:path";
import { applyDeploymentPattern } from "./control-plane-credentials";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";
import {
  assertCredentialDirectoryPath,
  resolveCredentialFileName,
} from "./control-plane-runtime-config-paths";

const INFISICAL_CLIENT_ID_PATTERN = "{deploymentId}-infisical-client-id";
const INFISICAL_CLIENT_SECRET_PATTERN = "{deploymentId}-infisical-client-secret";

export const CONTROL_PLANE_PRODUCTION_CREDENTIAL_ENV_NAMES = [
  "DATABASE_URL",
  "VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL",
  "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "INFISICAL_CLIENT_ID",
  "INFISICAL_CLIENT_SECRET",
  "INFISICAL_TOKEN",
  "INFISICAL_ACCESS_TOKEN",
  "INFISICAL_PERSONAL_TOKEN",
  "INFISICAL_SERVICE_TOKEN",
  "VAULT_TOKEN",
  "VAULT_ADDR",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ENDPOINT_URL",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "CLOUDFLARE_API_TOKEN",
  "VBR_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE",
  "VBR_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE",
  "GIT_SSH_COMMAND",
];

export async function validateControlPlaneRuntimeConfigFiles(
  config: ControlPlaneRuntimeConfig,
): Promise<void> {
  const required = [
    ["database.urlFile", config.database.urlFile],
    ["service.tokenFile", config.service.tokenFile],
    ["storage.artifactStore.endpointFile", config.storage.artifactStore.endpointFile],
    ["storage.artifactStore.accessKeyIdFile", config.storage.artifactStore.accessKeyIdFile],
    ["storage.artifactStore.secretAccessKeyFile", config.storage.artifactStore.secretAccessKeyFile],
    ["reviewedSource.sshKeyFile", config.reviewedSource.sshKeyFile],
    ["reviewedSource.sshKnownHostsFile", config.reviewedSource.sshKnownHostsFile],
    ...infisicalCredentialFiles(config),
  ] as const;
  const missing: string[] = [];
  for (const [fieldName, filePath] of required) {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) missing.push(`${fieldName}: ${redactConfigDiagnostic(filePath)}`);
    } catch {
      missing.push(`${fieldName}: ${redactConfigDiagnostic(filePath)}`);
    }
  }
  if (missing.length > 0)
    throw new Error(`missing required credential files: ${missing.join(", ")}`);
  await validateCredentialFileContents(config);
}

export function validateControlPlaneProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const present = CONTROL_PLANE_PRODUCTION_CREDENTIAL_ENV_NAMES.filter(
    (name) => String(env[name] || "").trim() !== "",
  );
  if (present.length > 0) {
    throw new Error(
      `production control-plane runtime rejects ambient credential env vars: ${present.join(", ")}`,
    );
  }
}

export function validateControlPlaneCredentialContract(config: ControlPlaneRuntimeConfig): void {
  const credentialBasenames = [
    ["storage.artifactStore.endpointFile", config.storage.artifactStore.endpointFile],
    ["storage.artifactStore.accessKeyIdFile", config.storage.artifactStore.accessKeyIdFile],
    ["storage.artifactStore.secretAccessKeyFile", config.storage.artifactStore.secretAccessKeyFile],
  ] as const;
  const expected = {
    "storage.artifactStore.endpointFile": "artifact-store-endpoint",
    "storage.artifactStore.accessKeyIdFile": "artifact-store-access-key-id",
    "storage.artifactStore.secretAccessKeyFile": "artifact-store-secret-access-key",
  } as const;
  for (const [fieldName, filePath] of credentialBasenames) {
    if (path.basename(filePath) !== expected[fieldName]) {
      throw new Error(`${fieldName} must use credential filename ${expected[fieldName]}`);
    }
  }
  validateExactDeploymentPattern(
    config.credentials.defaults.infisicalClientIdFilePattern,
    "credentials.defaults.infisicalClientIdFilePattern",
    INFISICAL_CLIENT_ID_PATTERN,
  );
  validateExactDeploymentPattern(
    config.credentials.defaults.infisicalClientSecretFilePattern,
    "credentials.defaults.infisicalClientSecretFilePattern",
    INFISICAL_CLIENT_SECRET_PATTERN,
  );
}

export function redactConfigDiagnostic(value: unknown): string {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-url>")
    .replace(
      /(client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|password|token|authorization)=\S+/gi,
      "$1=<redacted>",
    )
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "<redacted-pem>");
}

async function validateCredentialFileContents(config: ControlPlaneRuntimeConfig): Promise<void> {
  const databaseUrl = await readCredential(config.database.urlFile, "database.urlFile");
  parseUrl(databaseUrl, "database.urlFile");
  const endpoint = await readCredential(
    config.storage.artifactStore.endpointFile,
    "storage.artifactStore.endpointFile",
  );
  const endpointUrl = parseUrl(endpoint, "storage.artifactStore.endpointFile");
  if (!["http:", "https:"].includes(endpointUrl.protocol)) {
    throw new Error("storage.artifactStore.endpointFile must contain an http or https URL");
  }
  await assertNonEmptyCredential(config.service.tokenFile, "service.tokenFile");
  await assertNonEmptyCredential(
    config.storage.artifactStore.accessKeyIdFile,
    "storage.artifactStore.accessKeyIdFile",
  );
  await assertNonEmptyCredential(
    config.storage.artifactStore.secretAccessKeyFile,
    "storage.artifactStore.secretAccessKeyFile",
  );
  for (const [fieldName, filePath] of infisicalCredentialFiles(config)) {
    await assertNonEmptyCredential(filePath, fieldName);
  }
}

async function readCredential(filePath: string, fieldName: string): Promise<string> {
  try {
    return (await fsp.readFile(filePath, "utf8")).trim();
  } catch (error) {
    throw new Error(
      redactConfigDiagnostic(`failed to read credential file for ${fieldName}: ${error}`),
    );
  }
}

async function assertNonEmptyCredential(filePath: string, fieldName: string): Promise<void> {
  if ((await readCredential(filePath, fieldName)) === "") {
    throw new Error(`${fieldName} credential file must not be empty`);
  }
}

function parseUrl(value: string, fieldName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${fieldName} credential file must contain a valid URL`);
  }
}

function validateExactDeploymentPattern(
  pattern: string,
  fieldName: string,
  expected: string,
): void {
  if (pattern !== expected) {
    throw new Error(`${fieldName} must be exactly ${expected}`);
  }
}

function infisicalCredentialFiles(config: ControlPlaneRuntimeConfig): [string, string][] {
  return config.credentials.infisicalDeployments.flatMap((request) => {
    const prefix = `credentials.infisicalDeployments.${request.deploymentId}`;
    const clientIdName = exactInfisicalName(
      request.clientIdFileName,
      config.credentials.defaults.infisicalClientIdFilePattern,
      request.deploymentId,
      `${prefix}.clientIdFileName`,
    );
    const clientSecretName = exactInfisicalName(
      request.clientSecretFileName,
      config.credentials.defaults.infisicalClientSecretFilePattern,
      request.deploymentId,
      `${prefix}.clientSecretFileName`,
    );
    return [
      [`${prefix}.clientIdFile`, credentialPath(config, clientIdName)],
      [`${prefix}.clientSecretFile`, credentialPath(config, clientSecretName)],
    ];
  });
}

function credentialPath(config: ControlPlaneRuntimeConfig, fileName: string): string {
  return assertCredentialDirectoryPath(
    resolveCredentialFileName(config.credentials.directory, fileName),
    { credentialDirectory: config.credentials.directory },
  );
}

function exactInfisicalName(
  requested: string | undefined,
  pattern: string,
  deploymentId: string,
  fieldName: string,
): string {
  const expected = applyDeploymentPattern(pattern, deploymentId);
  if (requested !== undefined && requested !== expected) {
    throw new Error(`${fieldName} must be exactly ${expected}`);
  }
  return expected;
}
