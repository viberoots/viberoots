#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { VercelDeployment } from "./contract";
import { terminalSubmissionFromAdmissionFailure } from "./deployment-provider-control-plane-admission-failure";
import {
  enqueueBackendSubmission,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import { submitResponseFromSubmission } from "./deployment-control-plane-status";
import { submitVercelDeploy, submitVercelPreviewCleanup } from "./vercel-deploy";
import { submitVercelExactArtifactRun } from "./vercel-exact-run";
import { resolveVercelReplaySource } from "./vercel-replay";

export const VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA = "vercel-control-plane-submit-request@1";

export type VercelControlPlaneOperationKind =
  | "deploy"
  | "preview"
  | "preview_cleanup"
  | "retry"
  | "rollback";

export type VercelControlPlaneSubmitRequest = {
  schemaVersion: typeof VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: VercelDeployment;
  operationKind: VercelControlPlaneOperationKind;
  artifactDir?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
};

type Snapshot = {
  schemaVersion: "vercel-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: VercelControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: VercelDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifactDir?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
};

export async function queueVercelControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: VercelControlPlaneSubmitRequest;
}) {
  const snapshot: Snapshot = {
    schemaVersion: "vercel-control-plane-snapshot@1",
    submissionId: opts.request.submissionId,
    submittedAt: opts.request.submittedAt,
    operationKind: opts.request.operationKind,
    deploymentId: opts.request.deployment.deploymentId,
    deploymentLabel: opts.request.deployment.label,
    providerTargetIdentity: opts.request.deployment.providerTarget.providerTargetIdentity,
    lockScope: opts.request.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.request.deployment,
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    ...(opts.request.artifactDir ? { artifactDir: opts.request.artifactDir } : {}),
    ...(opts.request.expectedSourceRevision
      ? { expectedSourceRevision: opts.request.expectedSourceRevision }
      : {}),
    ...(opts.request.sourceRunId ? { sourceRunId: opts.request.sourceRunId } : {}),
    ...(opts.request.admissionEvidence
      ? { admissionEvidence: opts.request.admissionEvidence }
      : {}),
    ...(opts.request.smokeConnectOverride
      ? { smokeConnectOverride: opts.request.smokeConnectOverride }
      : {}),
  };
  const refs = {
    executionSnapshotPath: executionSnapshotPathFor(opts.recordsRoot, opts.request.submissionId),
    submissionPath: submissionPathFor(opts.recordsRoot, opts.request.submissionId),
  };
  await writeBackendSnapshotDoc(opts.backend, snapshot as any, refs.executionSnapshotPath);
  const submission = {
    schemaVersion: "deployment-provider-control-plane-submission@1",
    submissionId: opts.request.submissionId,
    submittedAt: opts.request.submittedAt,
    operationKind: opts.request.operationKind,
    deploymentId: opts.request.deployment.deploymentId,
    deploymentLabel: opts.request.deployment.label,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    executionSnapshotPath: refs.executionSnapshotPath,
    lifecycleState: "queued",
    terminationReason: null,
    dedupe: { mode: "created", requestFingerprint: `direct:${opts.request.submissionId}` },
    admission: { decision: "admitted", reason: opts.request.deployment.protectionClass },
  };
  await writeBackendSubmissionDoc(opts.backend, submission as any, refs);
  await enqueueBackendSubmission(opts.backend, opts.request.submissionId, opts.request.submittedAt);
  return submitResponseFromSubmission(submission as any);
}

export async function executeVercelControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
}) {
  const persistSubmissionStatus = async (nextSubmission: Record<string, unknown>) => {
    await writeControlPlaneJson(opts.submissionPath, nextSubmission);
    await writeBackendSubmissionDoc(opts.backend, nextSubmission as any, {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    });
  };
  const submission = JSON.parse(await fs.readFile(opts.submissionPath, "utf8"));
  const snapshot = JSON.parse(await fs.readFile(opts.executionSnapshotPath, "utf8")) as Snapshot;
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const runningSubmission = { ...submission, lifecycleState: "running", workerId: opts.workerId };
  try {
    await persistSubmissionStatus(runningSubmission);
    const result = await runVercelOperation({ workerId: opts.workerId, snapshot });
    result.record.controlPlane = {
      submissionId: snapshot.submissionId,
      workerId: opts.workerId,
      admission: "admitted",
      lockScope: snapshot.lockScope,
    };
    await writeBackendDeployRecordDoc(opts.backend, result.record, result.recordPath);
    await persistSubmissionStatus({
      ...submission,
      lifecycleState: "finished",
      completedAt: new Date().toISOString(),
      workerId: opts.workerId,
      deployRunId: result.record.deployRunId,
      resultRecordPath: result.recordPath,
      finalOutcome: result.record.finalOutcome,
    });
  } catch (error) {
    const rejected = terminalSubmissionFromAdmissionFailure({
      error,
      submission: runningSubmission,
      workerId: opts.workerId,
    });
    if (rejected) {
      await persistSubmissionStatus(rejected);
      return;
    }
    throw error;
  } finally {
    await lock.release();
  }
}

async function runVercelOperation(opts: { workerId: string; snapshot: Snapshot }) {
  const { snapshot } = opts;
  if (snapshot.operationKind === "deploy" || snapshot.operationKind === "preview") {
    return await submitVercelDeploy({
      workspaceRoot: snapshot.workspaceRoot,
      deployment: snapshot.deployment,
      recordsRoot: snapshot.recordsRoot,
      artifactDir: String(snapshot.artifactDir || ""),
      operationKind: snapshot.operationKind,
      ...(snapshot.sourceRunId ? { sourceRunId: snapshot.sourceRunId } : {}),
      ...(snapshot.smokeConnectOverride
        ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
        : {}),
    });
  }
  if (snapshot.operationKind === "preview_cleanup") {
    return await submitVercelPreviewCleanup({
      deployment: snapshot.deployment,
      recordsRoot: snapshot.recordsRoot,
      sourceRunId: String(snapshot.sourceRunId || ""),
    });
  }
  const source = await resolveVercelReplaySource({
    recordsRoot: snapshot.recordsRoot,
    deployRunId: String(snapshot.sourceRunId || ""),
  });
  return await submitVercelExactArtifactRun({
    deployment: snapshot.deployment,
    recordsRoot: snapshot.recordsRoot,
    operationKind: snapshot.operationKind,
    replaySnapshot: source.replaySnapshot,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    ...(snapshot.smokeConnectOverride
      ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
      : {}),
  });
}
