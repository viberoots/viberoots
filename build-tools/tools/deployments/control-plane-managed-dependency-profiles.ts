#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { assertCredentialDirectoryPath } from "./control-plane-runtime-config-paths";
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedArtifactStoreProvider,
  ManagedPostgresProvider,
} from "./control-plane-managed-dependency-types";

type RawObject = Record<string, unknown>;

const POSTGRES_PROVIDERS: ManagedPostgresProvider[] = ["supabase-postgres", "postgres-compatible"];
const ARTIFACT_PROVIDERS: ManagedArtifactStoreProvider[] = [
  "supabase-storage-s3",
  "cloudflare-r2",
  "s3-compatible",
];

export async function loadManagedDependencyProfile(opts: {
  profilePath: string;
  credentialDirectory: string;
}): Promise<ControlPlaneManagedDependencyProfile> {
  const raw = await fsp.readFile(opts.profilePath, "utf8");
  return parseManagedDependencyProfile(raw, {
    credentialDirectory: opts.credentialDirectory,
    baseDir: path.dirname(opts.profilePath),
  });
}

export function parseManagedDependencyProfile(
  raw: string,
  opts: { credentialDirectory: string; baseDir?: string },
): ControlPlaneManagedDependencyProfile {
  const value = YAML.parse(raw) as RawObject | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("managed dependency profile must be a YAML object");
  }
  const postgres = objectValue(value.postgres, "postgres");
  const artifactStore = objectValue(value.artifactStore, "artifactStore");
  const policy = { credentialDirectory: path.resolve(opts.credentialDirectory) };
  return {
    profileName: stringValue(value.profileName, "profileName"),
    compatibilityEvidenceFile: optionalEvidenceFile(
      value.compatibilityEvidenceFile,
      opts.baseDir || process.cwd(),
    ),
    postgres: {
      provider: enumValue(postgres.provider, POSTGRES_PROVIDERS, "postgres.provider"),
      urlFile: credentialFile(postgres.urlFile, "postgres.urlFile", policy),
    },
    artifactStore: {
      provider: enumValue(artifactStore.provider, ARTIFACT_PROVIDERS, "artifactStore.provider"),
      bucket: stringValue(artifactStore.bucket, "artifactStore.bucket"),
      region: stringValue(artifactStore.region, "artifactStore.region"),
      endpointFile: credentialFile(
        artifactStore.endpointFile,
        "artifactStore.endpointFile",
        policy,
      ),
      accessKeyIdFile: credentialFile(
        artifactStore.accessKeyIdFile,
        "artifactStore.accessKeyIdFile",
        policy,
      ),
      secretAccessKeyFile: credentialFile(
        artifactStore.secretAccessKeyFile,
        "artifactStore.secretAccessKeyFile",
        policy,
      ),
      keyPrefix: optionalString(artifactStore.keyPrefix, "artifactStore.keyPrefix"),
    },
  };
}

export async function readManagedDependencyCredential(filePath: string): Promise<string> {
  try {
    return (await fsp.readFile(filePath, "utf8")).trimEnd();
  } catch (error) {
    throw new Error(redactConfigDiagnostic(`failed to read credential file ${filePath}: ${error}`));
  }
}

function credentialFile(
  value: unknown,
  fieldName: string,
  policy: { credentialDirectory: string },
): string {
  return assertCredentialDirectoryPath(stringValue(value, fieldName), policy);
}

function optionalEvidenceFile(value: unknown, baseDir: string): string | undefined {
  if (value === undefined) return undefined;
  const raw = stringValue(value, "compatibilityEvidenceFile");
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

function objectValue(value: unknown, fieldName: string): RawObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as RawObject;
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, fieldName);
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${fieldName} has unsupported value`);
  }
  return value as T;
}
