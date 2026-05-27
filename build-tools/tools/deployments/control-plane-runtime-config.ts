import * as fsp from "node:fs/promises";
import YAML from "yaml";
import { normalizeAuthProviderConfig } from "./deployment-auth-provider-config";
import {
  DEFAULT_CONTROL_PLANE_CONFIG_PATH,
  type ControlPlaneRuntimeConfig,
} from "./control-plane-runtime-config-types";
import {
  assertCredentialDirectory,
  assertCredentialDirectoryPath,
  assertReviewedCredentialPath,
  normalizeAbsolutePath,
  validateBasePath,
} from "./control-plane-runtime-config-paths";
import {
  redactConfigDiagnostic,
  validateControlPlaneCredentialContract,
  validateControlPlaneProductionEnv,
  validateControlPlaneRuntimeConfigFiles,
} from "./control-plane-runtime-config-validation";

export { redactConfigDiagnostic, validateControlPlaneRuntimeConfigFiles };

type LoadOptions = {
  configPath?: string;
  repoRoot?: string;
  validateFiles?: boolean;
  runtimeMode?: "production" | "local-fixture";
  env?: NodeJS.ProcessEnv;
};

export async function loadControlPlaneRuntimeConfig(
  options: LoadOptions = {},
): Promise<ControlPlaneRuntimeConfig> {
  const configPath = options.configPath ?? DEFAULT_CONTROL_PLANE_CONFIG_PATH;
  const raw = await fsp.readFile(configPath, "utf8");
  const parsed = parseControlPlaneRuntimeConfig(raw, { repoRoot: options.repoRoot });
  if (options.runtimeMode !== "local-fixture") {
    validateControlPlaneProductionEnv(options.env);
  }
  if (options.validateFiles !== false) await validateControlPlaneRuntimeConfigFiles(parsed);
  return parsed;
}

export function parseControlPlaneRuntimeConfig(
  raw: string,
  options: { repoRoot?: string } = {},
): ControlPlaneRuntimeConfig {
  const value = YAML.parse(raw) as Record<string, unknown> | null;
  if (!value || typeof value !== "object")
    throw new Error("control-plane config must be a YAML object");
  const credentials = objectValue(value.credentials, "credentials");
  const directory = assertCredentialDirectory(
    normalizeAbsolutePath(
      stringValue(credentials.directory, "credentials.directory"),
      "credentials.directory",
    ),
    { repoRoot: options.repoRoot },
  );
  const policy = { credentialDirectory: directory, repoRoot: options.repoRoot };
  const config = withDefaults(value, directory);
  const parsed = {
    ...config,
    database: {
      urlFile: assertCredentialDirectoryPath(config.database.urlFile, policy),
    },
    service: {
      ...config.service,
      tokenFile: assertCredentialDirectoryPath(config.service.tokenFile, policy),
    },
    storage: {
      ...config.storage,
      artifactStore: {
        ...config.storage.artifactStore,
        endpointFile: assertCredentialDirectoryPath(
          config.storage.artifactStore.endpointFile,
          policy,
        ),
        accessKeyIdFile: assertCredentialDirectoryPath(
          config.storage.artifactStore.accessKeyIdFile,
          policy,
        ),
        secretAccessKeyFile: assertCredentialDirectoryPath(
          config.storage.artifactStore.secretAccessKeyFile,
          policy,
        ),
      },
    },
    reviewedSource: {
      sshKeyFile: assertReviewedCredentialPath(config.reviewedSource.sshKeyFile, policy),
      sshKnownHostsFile: assertReviewedCredentialPath(
        config.reviewedSource.sshKnownHostsFile,
        policy,
      ),
    },
  };
  validateControlPlaneCredentialContract(parsed);
  return parsed;
}

function withDefaults(
  value: Record<string, unknown>,
  directory: string,
): ControlPlaneRuntimeConfig {
  const service = objectValue(value.service, "service");
  const storage = objectValue(value.storage, "storage");
  const artifactStore = objectValue(storage.artifactStore, "storage.artifactStore");
  const database = objectValue(value.database, "database");
  const credentials = objectValue(value.credentials, "credentials");
  const defaults = objectValue(credentials.defaults ?? {}, "credentials.defaults");
  const reviewedSource = objectValue(value.reviewedSource, "reviewedSource");
  return {
    instanceId: stringValue(value.instanceId, "instanceId"),
    mode: enumValue(value.mode ?? "protected-shared", ["protected-shared", "dedicated"], "mode"),
    service: {
      host: stringValue(service.host ?? "0.0.0.0", "service.host"),
      port: numberValue(service.port ?? 7780, "service.port"),
      publicUrl: stringValue(service.publicUrl, "service.publicUrl"),
      tokenFile: stringValue(service.tokenFile, "service.tokenFile"),
    },
    storage: {
      recordsRoot: absoluteDefault(
        storage.recordsRoot,
        "/var/lib/deployment-control-plane/records",
        "storage.recordsRoot",
      ),
      artifactStagingRoot: absoluteDefault(
        storage.artifactStagingRoot,
        "/var/lib/deployment-control-plane/artifacts",
        "storage.artifactStagingRoot",
      ),
      runtimeRoot: absoluteDefault(
        storage.runtimeRoot,
        "/var/lib/deployment-control-plane/runtime",
        "storage.runtimeRoot",
      ),
      artifactStore: {
        kind: enumValue(
          artifactStore.kind ?? "s3-compatible",
          ["s3-compatible"],
          "storage.artifactStore.kind",
        ),
        bucket: stringValue(artifactStore.bucket, "storage.artifactStore.bucket"),
        region: stringValue(artifactStore.region ?? "auto", "storage.artifactStore.region"),
        endpointFile: stringValue(artifactStore.endpointFile, "storage.artifactStore.endpointFile"),
        accessKeyIdFile: stringValue(
          artifactStore.accessKeyIdFile,
          "storage.artifactStore.accessKeyIdFile",
        ),
        secretAccessKeyFile: stringValue(
          artifactStore.secretAccessKeyFile,
          "storage.artifactStore.secretAccessKeyFile",
        ),
      },
    },
    database: { urlFile: stringValue(database.urlFile, "database.urlFile") },
    credentials: {
      directory,
      defaults: {
        infisicalClientIdFilePattern: stringValue(
          defaults.infisicalClientIdFilePattern ?? "{deploymentId}-infisical-client-id",
          "credentials.defaults.infisicalClientIdFilePattern",
        ),
        infisicalClientSecretFilePattern: stringValue(
          defaults.infisicalClientSecretFilePattern ?? "{deploymentId}-infisical-client-secret",
          "credentials.defaults.infisicalClientSecretFilePattern",
        ),
      },
    },
    reviewedSource: {
      sshKeyFile: stringValue(reviewedSource.sshKeyFile, "reviewedSource.sshKeyFile"),
      sshKnownHostsFile: stringValue(
        reviewedSource.sshKnownHostsFile,
        "reviewedSource.sshKnownHostsFile",
      ),
    },
    webUi: sectionWithBasePath(value.webUi, "webUi", "/", true),
    mcp: sectionWithBasePath(value.mcp, "mcp", "/mcp", true),
    authProvider: normalizeAuthProviderConfig(value.authProvider),
    miniMigrationPreflight: {
      enabled: booleanValue(
        objectValue(value.miniMigrationPreflight ?? {}, "miniMigrationPreflight").enabled ?? false,
        "miniMigrationPreflight.enabled",
      ),
    },
  };
}

function sectionWithBasePath(value: unknown, name: string, basePath: string, enabled: boolean) {
  const section = objectValue(value ?? {}, name);
  return {
    enabled: booleanValue(section.enabled ?? enabled, `${name}.enabled`),
    basePath: validateBasePath(
      stringValue(section.basePath ?? basePath, `${name}.basePath`),
      `${name}.basePath`,
    ),
  };
}

function absoluteDefault(value: unknown, defaultValue: string, fieldName: string): string {
  return normalizeAbsolutePath(stringValue(value ?? defaultValue, fieldName), fieldName);
}

function objectValue(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

function numberValue(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${fieldName} must be a TCP port`);
  return value;
}

function booleanValue(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be a boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new Error(`${fieldName} has unsupported value`);
  return value as T;
}
