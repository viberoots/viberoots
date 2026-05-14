#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { VercelDeployment } from "./contract";
import { terminalSubmissionFromAdmissionFailure } from "./deployment-provider-control-plane-admission-failure";
import {
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import { withFrozenProviderWorkerSecretRuntime } from "./deployment-provider-worker-secret-runtime";
import { submitVercelDeploy, submitVercelPreviewCleanup } from "./vercel-deploy";
import { submitVercelExactArtifactRun } from "./vercel-exact-run";
import type { VercelApiClient } from "./vercel-api";
import {
  queueFrozenProviderSubmission,
  requireFrozenProviderSubmissionAdmission,
  requireFrozenProviderReplaySource,
  requireFrozenProviderSnapshot,
} from "./deployment-provider-frozen-snapshot";
import {
  buildVercelControlPlaneSnapshot,
  type VercelControlPlaneSnapshot as Snapshot,
} from "./vercel-control-plane-snapshot";

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

export async function queueVercelControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: VercelControlPlaneSubmitRequest;
}) {
  const snapshot = await buildVercelControlPlaneSnapshot(opts);
  return await queueFrozenProviderSubmission({
    recordsRoot: opts.recordsRoot,
    backend: opts.backend,
    snapshot,
  });
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
  apiClient?: VercelApiClient;
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
  requireFrozenProviderSnapshot(snapshot, "vercel");
  requireFrozenProviderSubmissionAdmission({ provider: "vercel", submission, snapshot });
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const runningSubmission = { ...submission, lifecycleState: "running", workerId: opts.workerId };
  try {
    await persistSubmissionStatus(runningSubmission);
    const result = await withFrozenProviderWorkerSecretRuntime(
      { workspaceRoot: opts.workspaceRoot, deployment: snapshot.deployment },
      async () =>
        await runVercelOperation({
          workerId: opts.workerId,
          snapshot,
          ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
        }),
    );
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

async function runVercelOperation(opts: {
  workerId: string;
  snapshot: Snapshot;
  apiClient?: VercelApiClient;
}) {
  const { snapshot } = opts;
  if (snapshot.operationKind === "deploy" || snapshot.operationKind === "preview") {
    return await submitVercelDeploy({
      workspaceRoot: snapshot.workspaceRoot,
      deployment: snapshot.deployment,
      recordsRoot: snapshot.recordsRoot,
      artifactDir: "",
      ...(snapshot.artifact ? { artifact: snapshot.artifact } : {}),
      ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext as any } : {}),
      operationKind: snapshot.operationKind,
      ...(snapshot.sourceRunId ? { sourceRunId: snapshot.sourceRunId } : {}),
      ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
      ...(snapshot.smokeConnectOverride
        ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
        : {}),
    });
  }
  if (snapshot.operationKind === "preview_cleanup") {
    const source = requireFrozenProviderReplaySource(snapshot, "vercel");
    return await submitVercelPreviewCleanup({
      deployment: snapshot.deployment,
      recordsRoot: snapshot.recordsRoot,
      sourceRunId: snapshot.parentRunId || source.record.deployRunId,
      ...(source.record.providerReleaseId
        ? { providerDeploymentId: source.record.providerReleaseId }
        : {}),
      ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
      ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext as any } : {}),
    });
  }
  const source = requireFrozenProviderReplaySource(snapshot, "vercel");
  return await submitVercelExactArtifactRun({
    deployment: snapshot.deployment,
    recordsRoot: snapshot.recordsRoot,
    operationKind: snapshot.operationKind,
    replaySnapshot: source.replaySnapshot,
    parentRunId: snapshot.parentRunId as string,
    releaseLineageId: snapshot.releaseLineageId as string,
    artifactLineageId: snapshot.artifactLineageId as string,
    ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext as any } : {}),
    ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
    ...(snapshot.smokeConnectOverride
      ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
      : {}),
  });
}
