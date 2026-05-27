#!/usr/bin/env zx-wrapper
import { checkControlPlaneReadiness, readWorkerHeartbeats } from "./control-plane-process-health";
import { readControlPlaneImageMetadata } from "./control-plane-image-metadata";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import { statusFromSubmission } from "./deployment-control-plane-status";
import { redactControlPlaneReadModel } from "./deployment-control-plane-read-redaction";
import { readBackendControlPlaneAuditEvents } from "./deployment-control-plane-audit";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";
import {
  readBackendCurrentStageStates,
  readBackendLatestDeployRecordEnvelopeByDeploymentId,
} from "./nixos-shared-host-control-plane-backend";

type RecentSubmissionRow = {
  submission_id: string;
  lifecycle_state: string;
  deploy_run_id?: string | null;
  updated_at: string;
  document_json: unknown;
};

export async function readControlPlaneRuntimeStatus(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  objectStore?: ControlPlaneArtifactStore;
  instanceId?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const readiness = await checkControlPlaneReadiness(opts);
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-read-status@1",
    instanceId: opts.instanceId || "unknown",
    image: readControlPlaneImageMetadata(opts.env),
    database: readiness.database,
    artifactStore: readiness.artifactStore,
    workers: readiness.workers,
  });
}

export async function readControlPlaneQueueSummary(
  backend: NixosSharedHostControlPlaneBackendTarget,
  limit = 25,
) {
  const rows = (
    await queryBackend<RecentSubmissionRow>(
      backend,
      `SELECT submission_id, lifecycle_state, deploy_run_id, updated_at, document_json
       FROM submissions
       ORDER BY updated_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    )
  ).rows;
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-read-queue@1",
    submissions: rows.map((row) => submissionSummary(row)),
  });
}

export async function readControlPlaneWorkerHeartbeatSummary(
  backend: NixosSharedHostControlPlaneBackendTarget,
) {
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-read-worker-heartbeats@1",
    workers: await readWorkerHeartbeats(backend),
  });
}

export async function readControlPlaneDeploymentDetail(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deploymentId: string,
) {
  const [latest, stages, auditEvents] = await Promise.all([
    readBackendLatestDeployRecordEnvelopeByDeploymentId(backend, { deploymentId }),
    readBackendCurrentStageStates(backend, { deploymentId }),
    readBackendControlPlaneAuditEvents(backend, deploymentId),
  ]);
  const latestRecord = latest?.record as Record<string, any> | undefined;
  return redactControlPlaneReadModel({
    schemaVersion: "control-plane-read-deployment@1",
    deploymentId,
    currentStages: stages,
    auditSummary: auditEvents.slice(-25),
    artifactReferences: artifactReferencesFor(latestRecord),
    latestRun: latest ? publicDeployRecordSummary(latestRecord || {}, latest.updatedAt) : null,
  });
}

function publicDeployRecordSummary(record: Record<string, any>, updatedAt: string) {
  return {
    deployRunId: record.deployRunId,
    submissionId: record.controlPlane?.submissionId,
    workerId: record.controlPlane?.workerId,
    updatedAt,
    deploymentId: record.deploymentId,
    deploymentLabel: record.deploymentLabel,
    operationKind: record.operationKind,
    runClassification: record.runClassification,
    lifecycleState: record.lifecycleState,
    finalOutcome: record.finalOutcome,
    failedStep: record.failedStep,
    provider: record.provider,
    providerTargetIdentity: record.providerTargetIdentity,
    publicUrl: record.publicUrl,
    healthUrl: record.healthUrl,
    error: record.error,
    errorFingerprint: record.errorFingerprint,
    artifactIdentity: record.artifact?.identity || record.artifactIdentity,
    artifactLineageId: record.artifactLineageId,
    deployBatchId: record.deployBatchId,
    parentRunId: record.parentRunId,
    releaseLineageId: record.releaseLineageId,
    deploymentMetadataFingerprint: record.deploymentMetadataFingerprint,
    progressiveRollout: record.progressiveRollout,
  };
}

function artifactReferencesFor(record?: Record<string, any>) {
  if (!record) return [];
  const refs = [
    artifactReference(record.artifact),
    artifactReference(record.artifactObject),
    artifactReference(record.artifactReference),
  ].filter((ref): ref is Record<string, unknown> => Boolean(ref));
  if (record.artifactIdentity || record.artifactLineageId) {
    refs.unshift({
      artifactIdentity: record.artifactIdentity || record.artifactLineageId,
      artifactLineageId: record.artifactLineageId,
    });
  }
  return refs;
}

function artifactReference(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  return {
    identity: object.identity || object.artifactIdentity,
    lineageId: object.artifactLineageId,
    digest: object.digest,
    objectKey: object.key || object.objectKey,
    bucket: object.bucket,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes,
  };
}

function submissionSummary(row: RecentSubmissionRow) {
  const doc = decodeBackendJson<any>(row.document_json);
  return {
    submissionId: row.submission_id,
    deploymentId: doc.deploymentId,
    deploymentLabel: doc.deploymentLabel,
    operationKind: doc.operationKind,
    lifecycleState: row.lifecycle_state,
    deployRunId: row.deploy_run_id || doc.deployRunId,
    updatedAt: row.updated_at,
    status: statusFromSubmission(doc),
  };
}
