#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { assertCredentialDirectoryPath } from "./control-plane-runtime-config-paths";
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedArtifactStoreProvider,
  ManagedDatabaseConnectivityMode,
  ManagedPostgresProvider,
  ManagedRuntimeSourceHostKind,
} from "./control-plane-managed-dependency-types";
import {
  artifactCredentialMode,
  assertArtifactCredentialModeAllowed,
} from "./control-plane-artifact-credential-mode";
import { validateSupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-validation";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";

type RawObject = Record<string, unknown>;

const POSTGRES_PROVIDERS: ManagedPostgresProvider[] = ["supabase-postgres", "postgres-compatible"];
const ARTIFACT_PROVIDERS: ManagedArtifactStoreProvider[] = [
  "aws-s3",
  "supabase-storage-s3",
  "cloudflare-r2",
  "s3-compatible",
];
const DATABASE_MODES: ManagedDatabaseConnectivityMode[] = ["public", "privatelink"];
const SOURCE_HOST_KINDS: ManagedRuntimeSourceHostKind[] = ["aws-ec2", "diagnostic", "unknown"];

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
  const runtimePath = objectValue(value.runtimePath, "runtimePath");
  const policy = { credentialDirectory: path.resolve(opts.credentialDirectory) };
  const postgresProvider = enumValue(postgres.provider, POSTGRES_PROVIDERS, "postgres.provider");
  const supabasePostgres = optionalSupabasePostgres(value.supabasePostgres);
  if (postgresProvider === "supabase-postgres" && !supabasePostgres) {
    throw new Error("supabase-postgres managed dependency profile requires supabasePostgres");
  }
  return {
    profileName: stringValue(value.profileName, "profileName"),
    compatibilityEvidenceFile: optionalEvidenceFile(
      value.compatibilityEvidenceFile,
      opts.baseDir || process.cwd(),
    ),
    supabasePostgres,
    runtimePath: {
      expectedHostProfile: stringValue(
        runtimePath.expectedHostProfile,
        "runtimePath.expectedHostProfile",
      ),
      expectedAwsRegion: stringValue(
        runtimePath.expectedAwsRegion,
        "runtimePath.expectedAwsRegion",
      ),
      databaseConnectivityMode: enumValue(
        runtimePath.databaseConnectivityMode,
        DATABASE_MODES,
        "runtimePath.databaseConnectivityMode",
      ),
      expectedSupabaseProjectRef: optionalString(
        runtimePath.expectedSupabaseProjectRef,
        "runtimePath.expectedSupabaseProjectRef",
      ),
      expectedSupabaseRegion: optionalString(
        runtimePath.expectedSupabaseRegion,
        "runtimePath.expectedSupabaseRegion",
      ),
      expectedPrivateLinkEndpointId: optionalString(
        runtimePath.expectedPrivateLinkEndpointId,
        "runtimePath.expectedPrivateLinkEndpointId",
      ),
      expectedPrivateLinkResourceId: optionalString(
        runtimePath.expectedPrivateLinkResourceId,
        "runtimePath.expectedPrivateLinkResourceId",
      ),
      expectedS3VpcEndpointId: optionalString(
        runtimePath.expectedS3VpcEndpointId,
        "runtimePath.expectedS3VpcEndpointId",
      ),
      expectedS3EndpointPolicyDigest: optionalString(
        runtimePath.expectedS3EndpointPolicyDigest,
        "runtimePath.expectedS3EndpointPolicyDigest",
      ),
      expectedArtifactIamRoleArn: optionalString(
        runtimePath.expectedArtifactIamRoleArn,
        "runtimePath.expectedArtifactIamRoleArn",
      ),
      expectedArtifactLeastPrivilegePolicyDigest: optionalString(
        runtimePath.expectedArtifactLeastPrivilegePolicyDigest,
        "runtimePath.expectedArtifactLeastPrivilegePolicyDigest",
      ),
      expectedAlternateBackendEvidenceRef: optionalString(
        runtimePath.expectedAlternateBackendEvidenceRef,
        "runtimePath.expectedAlternateBackendEvidenceRef",
      ),
      expectedAlternateBackendEvidenceDigest: optionalString(
        runtimePath.expectedAlternateBackendEvidenceDigest,
        "runtimePath.expectedAlternateBackendEvidenceDigest",
      ),
      nonCutoverDiagnostic: optionalBoolean(
        runtimePath.nonCutoverDiagnostic,
        "runtimePath.nonCutoverDiagnostic",
      ),
    },
    postgres: {
      provider: postgresProvider,
      urlFile: credentialFile(postgres.urlFile, "postgres.urlFile", policy),
    },
    artifactStore: {
      provider: enumValue(artifactStore.provider, ARTIFACT_PROVIDERS, "artifactStore.provider"),
      credentialMode: parsedArtifactCredentialMode(artifactStore, "artifactStore.credentialMode"),
      bucket: stringValue(artifactStore.bucket, "artifactStore.bucket"),
      region: stringValue(artifactStore.region, "artifactStore.region"),
      endpointFile: credentialFile(
        artifactStore.endpointFile,
        "artifactStore.endpointFile",
        policy,
      ),
      accessKeyIdFile: optionalCredentialFile(
        artifactStore.accessKeyIdFile,
        "artifactStore.accessKeyIdFile",
        policy,
      ),
      secretAccessKeyFile: optionalCredentialFile(
        artifactStore.secretAccessKeyFile,
        "artifactStore.secretAccessKeyFile",
        policy,
      ),
      keyPrefix: optionalString(artifactStore.keyPrefix, "artifactStore.keyPrefix"),
    },
  };
}

function optionalSupabasePostgres(value: unknown): SupabaseManagedPostgresProfile | undefined {
  if (value === undefined) return undefined;
  const profile = objectValue(
    value,
    "supabasePostgres",
  ) as unknown as SupabaseManagedPostgresProfile;
  const errors = validateSupabaseManagedPostgresProfile(profile);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return profile;
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

function optionalCredentialFile(
  value: unknown,
  fieldName: string,
  policy: { credentialDirectory: string },
): string | undefined {
  if (value === undefined) return undefined;
  return credentialFile(value, fieldName, policy);
}

function parsedArtifactCredentialMode(
  artifactStore: RawObject,
  fieldName: string,
): "files" | "aws-instance-profile" {
  const credentialMode = artifactCredentialMode(artifactStore.credentialMode);
  const provider = enumValue(artifactStore.provider, ARTIFACT_PROVIDERS, "artifactStore.provider");
  assertArtifactCredentialModeAllowed({ provider, credentialMode, fieldName });
  if (
    credentialMode === "files" &&
    (artifactStore.accessKeyIdFile === undefined || artifactStore.secretAccessKeyFile === undefined)
  ) {
    throw new Error("artifactStore file credential mode requires access key files");
  }
  return credentialMode;
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

export function parseManagedRuntimeSourceHostKind(value: string): ManagedRuntimeSourceHostKind {
  return enumValue(value, SOURCE_HOST_KINDS, "sourceHostKind");
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${fieldName} has unsupported value`);
  }
  return value as T;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be a boolean`);
  return value;
}
