#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { putVerifiedArtifactObject } from "./control-plane-artifact-store";
import { createS3CompatibleArtifactStore } from "./control-plane-artifact-store-http";
import {
  createImdsV2CredentialProvider,
  observeAwsCredentialRole,
  type AwsCredentialProvider,
} from "./control-plane-aws-imds-credentials";
import { readManagedDependencyCredential } from "./control-plane-managed-dependency-profiles";
import {
  runtimePathEvidence,
  validateArtifactRuntimeEvidence,
  validatePostgresRuntimeEvidence,
  validateRuntimePathEvidence,
} from "./control-plane-managed-dependency-runtime";
import {
  assertPostgresMatchesRuntimePath,
  postgresConnectionFacts,
} from "./control-plane-managed-dependency-postgres-runtime";
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedDependencyValidationExpectations,
  ManagedDependencyEvidence,
  ManagedRuntimePathFacts,
} from "./control-plane-managed-dependency-types";
import {
  evidenceObject,
  evidenceSecretErrors,
  freshEvidenceAt,
} from "./cloud-control-evidence-helpers";
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";
import { validateManagedPostgresFeatures } from "./nixos-shared-host-control-plane-backend-features";
import { validateSupabasePostgresLifecycle } from "./control-plane-managed-dependency-supabase";
import { expectationsFromProfile } from "./control-plane-managed-dependency-expectations";

export async function validateManagedDependencyProfile(
  profile: ControlPlaneManagedDependencyProfile,
  runtimeFacts: ManagedRuntimePathFacts = {},
): Promise<ManagedDependencyEvidence> {
  const [postgres, artifactStore] = await Promise.all([
    withRedactedErrors("managed Postgres", () =>
      validateManagedPostgresProfile(profile, runtimeFacts),
    ),
    withRedactedErrors("managed artifact store", () =>
      validateManagedArtifactStoreProfile(profile, runtimeFacts),
    ),
  ]);
  const evidence: ManagedDependencyEvidence = {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: profile.profileName,
    checkedAt: new Date().toISOString(),
    ...(profile.supabasePostgresEvidence
      ? { supabasePostgres: profile.supabasePostgresEvidence }
      : {}),
    runtimePath: runtimePathEvidence(profile, runtimeFacts),
    postgres,
    artifactStore,
  };
  const errors = validateManagedDependencyEvidence(evidence, 1, expectationsFromProfile(profile));
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (profile.compatibilityEvidenceFile) {
    await writeEvidence(profile.compatibilityEvidenceFile, evidence);
  }
  return evidence;
}

export function validateManagedDependencyEvidence(
  value: unknown,
  maxAgeMinutes: number,
  opts: ManagedDependencyValidationExpectations = {},
): string[] {
  const evidence = evidenceObject(value);
  const errors: string[] = [];
  if (evidence.schemaVersion !== "control-plane-managed-dependency-evidence@1") {
    errors.push("managed dependency evidence has unsupported schemaVersion");
  }
  if (!freshEvidenceAt(evidence, { maxAgeMinutes })) {
    errors.push("managed dependency evidence is missing or stale");
  }
  if (typeof evidence.profileName !== "string" || !evidence.profileName.trim()) {
    errors.push("managed dependency evidence missing profileName");
  }
  errors.push(...(opts.expectationErrors || []));
  errors.push(...evidenceSecretErrors(evidence, "managedDependencies"));
  const postgres = evidenceObject(evidence.postgres);
  const artifactStore = evidenceObject(evidence.artifactStore);
  const runtimePath = evidenceObject(evidence.runtimePath);
  errors.push(...validateRuntimePathEvidence(runtimePath, opts));
  errors.push(...validateSupabasePostgresLifecycle(evidence, opts));
  if (!Array.isArray(postgres.checkedFeatures) || postgres.checkedFeatures.length === 0) {
    errors.push("managed dependency evidence missing Postgres feature checks");
  }
  errors.push(...validatePostgresRuntimeEvidence(postgres, runtimePath, opts));
  if (
    !Array.isArray(artifactStore.checkedOperations) ||
    !["PUT", "GET", "HEAD"].every((operation) =>
      artifactStore.checkedOperations.includes(operation),
    )
  ) {
    errors.push("managed dependency evidence missing artifact-store operation checks");
  }
  if (typeof artifactStore.digest !== "string" || !artifactStore.digest.startsWith("sha256:")) {
    errors.push("managed dependency evidence missing artifact-store digest");
  }
  errors.push(...validateArtifactRuntimeEvidence(artifactStore, runtimePath, opts));
  return errors;
}

async function withRedactedErrors<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} validation failed: ${redactConfigDiagnostic(message)}`);
  }
}

export async function validateManagedPostgresProfile(
  profile: ControlPlaneManagedDependencyProfile,
  runtimeFacts: ManagedRuntimePathFacts = {},
) {
  const databaseUrl = await readManagedDependencyCredential(profile.postgres.urlFile);
  const facts = postgresConnectionFacts(databaseUrl);
  assertPostgresMatchesRuntimePath(profile, facts);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: "viberoots-managed-dependency-conformance",
  });
  const client = await pool.connect();
  try {
    const result = await validateManagedPostgresFeatures(client);
    return {
      provider: profile.postgres.provider,
      serverVersionNum: result.serverVersionNum,
      checkedFeatures: result.checkedFeatures,
      resolvedHost: facts.resolvedHost,
      tlsEnabled: facts.tlsEnabled,
      peerHostIdentity: facts.resolvedHost,
      databaseConnectivityMode: profile.runtimePath.databaseConnectivityMode,
      sourceHostIdentity: runtimeFacts.sourceHostIdentity,
      sourceHostKind: runtimeFacts.sourceHostKind,
      supabaseProjectRef: facts.supabaseProjectRef || runtimeFacts.supabaseProjectRef,
      supabaseRegion: runtimeFacts.supabaseRegion,
      privatelinkEndpointId: runtimeFacts.privatelinkEndpointId,
      privatelinkResourceId: runtimeFacts.privatelinkResourceId,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

export async function validateManagedArtifactStoreProfile(
  profile: ControlPlaneManagedDependencyProfile,
  runtimeFacts: ManagedRuntimePathFacts = {},
  opts: { credentialProvider?: AwsCredentialProvider } = {},
) {
  const artifactStore = profile.artifactStore;
  const endpoint = await readManagedDependencyCredential(artifactStore.endpointFile);
  const fileCredentials =
    artifactStore.credentialMode === "files"
      ? await artifactStoreFileCredentials(artifactStore)
      : {};
  let observedArtifactIamRoleName: string | undefined;
  const provider = opts.credentialProvider || createImdsV2CredentialProvider();
  const store = createS3CompatibleArtifactStore({
    provider: artifactStore.provider,
    credentialMode: artifactStore.credentialMode,
    endpoint,
    bucket: artifactStore.bucket,
    region: artifactStore.region,
    ...fileCredentials,
    ...(artifactStore.credentialMode === "aws-instance-profile"
      ? {
          credentialProvider: observeAwsCredentialRole(provider, (identity) => {
            observedArtifactIamRoleName = identity.roleName;
          }),
        }
      : {}),
    keyPrefix: artifactStore.keyPrefix,
  });
  const object = await putVerifiedArtifactObject({
    store,
    body: Buffer.from(`managed dependency conformance ${crypto.randomUUID()}\n`),
    payloadKind: "artifact",
    provenance: {
      deploymentId: "managed-dependency-conformance",
      submissionId: crypto.randomUUID(),
      artifactIdentity: "control-plane:managed-dependency-conformance",
    },
  });
  return {
    provider: artifactStore.provider,
    bucket: artifactStore.bucket,
    region: artifactStore.region,
    endpointHost: new URL(endpoint).host,
    keyPrefix: artifactStore.keyPrefix,
    sourceHostIdentity: runtimeFacts.sourceHostIdentity,
    sourceHostKind: runtimeFacts.sourceHostKind,
    s3VpcEndpointId: runtimeFacts.s3VpcEndpointId,
    s3EndpointPolicyDigest: runtimeFacts.s3EndpointPolicyDigest,
    artifactCredentialMode: artifactStore.credentialMode,
    expectedArtifactIamRoleArn: runtimeFacts.artifactIamRoleArn,
    observedArtifactIamRoleName,
    artifactLeastPrivilegePolicyDigest: runtimeFacts.artifactLeastPrivilegePolicyDigest,
    alternateBackendEvidenceRef: runtimeFacts.alternateBackendEvidenceRef,
    alternateBackendEvidenceDigest: runtimeFacts.alternateBackendEvidenceDigest,
    checkedOperations: ["PUT", "GET", "HEAD", "metadata", "content-type", "digest"],
    digest: object.digest,
    objectKey: object.key,
  };
}

async function artifactStoreFileCredentials(
  artifactStore: ControlPlaneManagedDependencyProfile["artifactStore"],
) {
  if (!artifactStore.accessKeyIdFile || !artifactStore.secretAccessKeyFile) {
    throw new Error("file-backed managed artifact store requires access key credential files");
  }
  const [accessKeyId, secretAccessKey] = await Promise.all([
    readManagedDependencyCredential(artifactStore.accessKeyIdFile),
    readManagedDependencyCredential(artifactStore.secretAccessKeyFile),
  ]);
  return { accessKeyId, secretAccessKey };
}

async function writeEvidence(filePath: string, evidence: ManagedDependencyEvidence): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
