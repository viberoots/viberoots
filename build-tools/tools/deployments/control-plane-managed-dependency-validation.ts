#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { putVerifiedArtifactObject } from "./control-plane-artifact-store";
import { createS3CompatibleArtifactStore } from "./control-plane-artifact-store-http";
import { readManagedDependencyCredential } from "./control-plane-managed-dependency-profiles";
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedDependencyEvidence,
} from "./control-plane-managed-dependency-types";
import { redactConfigDiagnostic } from "./control-plane-runtime-config-validation";
import { validateManagedPostgresFeatures } from "./nixos-shared-host-control-plane-backend-features";

export async function validateManagedDependencyProfile(
  profile: ControlPlaneManagedDependencyProfile,
): Promise<ManagedDependencyEvidence> {
  const [postgres, artifactStore] = await Promise.all([
    withRedactedErrors("managed Postgres", () => validateManagedPostgresProfile(profile)),
    withRedactedErrors("managed artifact store", () =>
      validateManagedArtifactStoreProfile(profile),
    ),
  ]);
  const evidence: ManagedDependencyEvidence = {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: profile.profileName,
    checkedAt: new Date().toISOString(),
    postgres,
    artifactStore,
  };
  if (profile.compatibilityEvidenceFile) {
    await writeEvidence(profile.compatibilityEvidenceFile, evidence);
  }
  return evidence;
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
) {
  const databaseUrl = await readManagedDependencyCredential(profile.postgres.urlFile);
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
    };
  } finally {
    client.release();
    await pool.end();
  }
}

export async function validateManagedArtifactStoreProfile(
  profile: ControlPlaneManagedDependencyProfile,
) {
  const artifactStore = profile.artifactStore;
  const [endpoint, accessKeyId, secretAccessKey] = await Promise.all([
    readManagedDependencyCredential(artifactStore.endpointFile),
    readManagedDependencyCredential(artifactStore.accessKeyIdFile),
    readManagedDependencyCredential(artifactStore.secretAccessKeyFile),
  ]);
  const store = createS3CompatibleArtifactStore({
    endpoint,
    bucket: artifactStore.bucket,
    region: artifactStore.region,
    accessKeyId,
    secretAccessKey,
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
    checkedOperations: ["PUT", "GET", "HEAD", "metadata", "content-type", "digest"],
    digest: object.digest,
    objectKey: object.key,
  };
}

async function writeEvidence(filePath: string, evidence: ManagedDependencyEvidence): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
