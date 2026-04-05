#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import type { CloudflarePagesControlPlaneWorkerAuthority } from "./cloudflare-pages-control-plane-contract.ts";
import { CLOUDFLARE_PAGES_PROVIDER, type CloudflarePagesDeployment } from "./contract.ts";

export const CLOUDFLARE_PAGES_RECORD_SCHEMA = "deploy-record@2026-04-04";

export type CloudflarePagesOperationKind = "deploy" | "promotion";
export type CloudflarePagesRunClassification = CloudflarePagesOperationKind;

export type CloudflarePagesDeployRecord = {
  schemaVersion: typeof CLOUDFLARE_PAGES_RECORD_SCHEMA;
  deployRunId: string;
  operationKind: CloudflarePagesOperationKind;
  runClassification: CloudflarePagesRunClassification;
  publishMode: "normal";
  lifecycleState: "finished";
  terminationReason: null;
  finalOutcome: "succeeded" | "publish_failed" | "smoke_failed_after_publish";
  deploymentId: string;
  deploymentLabel: string;
  provider: typeof CLOUDFLARE_PAGES_PROVIDER;
  providerTarget: CloudflarePagesDeployment["providerTarget"];
  effectiveRunTarget: CloudflarePagesDeployment["providerTarget"];
  providerTargetIdentity: string;
  controlPlane?: {
    submissionId: string;
    submissionPath: string;
    workerId: string;
    admission: "admitted";
    lockScope: string;
    executionSnapshotPath: string;
  };
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  artifact?: {
    identity: string;
    storedArtifactPath?: string;
    provenancePath?: string;
  };
  admittedContext: CloudflarePagesAdmittedContext;
  failedStep?: "publish" | "smoke";
  publisherType: string;
  smokeRunnerType: "cloudflare-pages-static-webapp-smoke";
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  publicUrl?: string;
  providerReleaseId?: string;
  error?: string;
};

type RecordOutcome = {
  deployRunId: string;
  operationKind?: CloudflarePagesOperationKind;
  runClassification?: CloudflarePagesRunClassification;
  finalOutcome: CloudflarePagesDeployRecord["finalOutcome"];
  artifactIdentity: string;
  artifactStoredArtifactPath?: string;
  artifactProvenancePath?: string;
  admittedContext: CloudflarePagesAdmittedContext;
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  failedStep?: CloudflarePagesDeployRecord["failedStep"];
  deploymentMetadataFingerprint?: string;
  providerConfigFingerprint?: string;
  replaySnapshotPath?: string;
  publicUrl?: string;
  providerReleaseId?: string;
  error?: string;
};

export function createCloudflarePagesDeployRunId(prefix = "deploy"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function createCloudflarePagesDeployRecord(
  deployment: CloudflarePagesDeployment,
  outcome: RecordOutcome,
): CloudflarePagesDeployRecord {
  return {
    schemaVersion: CLOUDFLARE_PAGES_RECORD_SCHEMA,
    deployRunId: outcome.deployRunId,
    operationKind: outcome.operationKind || "deploy",
    runClassification: outcome.runClassification || outcome.operationKind || "deploy",
    publishMode: "normal",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: outcome.finalOutcome,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    provider: CLOUDFLARE_PAGES_PROVIDER,
    providerTarget: deployment.providerTarget,
    effectiveRunTarget: deployment.providerTarget,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    ...(outcome.authority
      ? {
          controlPlane: {
            submissionId: outcome.authority.submissionId,
            submissionPath: outcome.authority.submissionPath,
            workerId: outcome.authority.workerId,
            admission: "admitted" as const,
            lockScope: outcome.authority.lockScope,
            executionSnapshotPath: outcome.authority.executionSnapshotPath,
          },
        }
      : {}),
    ...(outcome.parentRunId ? { parentRunId: outcome.parentRunId } : {}),
    ...(outcome.releaseLineageId ? { releaseLineageId: outcome.releaseLineageId } : {}),
    ...(outcome.artifactLineageId ? { artifactLineageId: outcome.artifactLineageId } : {}),
    artifact: {
      identity: outcome.artifactIdentity,
      ...(outcome.artifactStoredArtifactPath
        ? { storedArtifactPath: outcome.artifactStoredArtifactPath }
        : {}),
      ...(outcome.artifactProvenancePath ? { provenancePath: outcome.artifactProvenancePath } : {}),
    },
    admittedContext: outcome.admittedContext,
    ...(outcome.failedStep ? { failedStep: outcome.failedStep } : {}),
    publisherType: deployment.publisher.type,
    smokeRunnerType: "cloudflare-pages-static-webapp-smoke",
    ...(outcome.deploymentMetadataFingerprint
      ? { deploymentMetadataFingerprint: outcome.deploymentMetadataFingerprint }
      : {}),
    ...(outcome.providerConfigFingerprint
      ? { providerConfigFingerprint: outcome.providerConfigFingerprint }
      : {}),
    ...(outcome.replaySnapshotPath ? { replaySnapshotPath: outcome.replaySnapshotPath } : {}),
    ...(outcome.publicUrl ? { publicUrl: outcome.publicUrl } : {}),
    ...(outcome.providerReleaseId ? { providerReleaseId: outcome.providerReleaseId } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

export function deployRecordPathFor(recordsRoot: string, deployRunId: string): string {
  return path.join(path.resolve(recordsRoot), "runs", `${deployRunId}.json`);
}

export async function writeCloudflarePagesDeployRecord(
  recordsRoot: string,
  record: CloudflarePagesDeployRecord,
): Promise<string> {
  const recordPath = deployRecordPathFor(recordsRoot, record.deployRunId);
  await fsp.mkdir(path.dirname(recordPath), { recursive: true });
  await fsp.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return recordPath;
}

export async function readCloudflarePagesDeployRecord(
  recordPath: string,
): Promise<CloudflarePagesDeployRecord> {
  const record = JSON.parse(await fsp.readFile(recordPath, "utf8")) as CloudflarePagesDeployRecord;
  if (
    record.schemaVersion !== CLOUDFLARE_PAGES_RECORD_SCHEMA ||
    typeof record.deployRunId !== "string" ||
    typeof record.deploymentLabel !== "string"
  ) {
    throw new Error(`invalid cloudflare-pages deploy record: ${recordPath}`);
  }
  return record;
}
