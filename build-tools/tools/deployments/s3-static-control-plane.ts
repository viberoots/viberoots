#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { S3StaticDeployment } from "./contract";
import { terminalSubmissionFromAdmissionFailure } from "./deployment-provider-control-plane-admission-failure";
import { assertCrossDeploymentExactPromotionEligible } from "./deployment-provider-promotion";
import {
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import { withFrozenProviderWorkerSecretRuntime } from "./deployment-provider-worker-secret-runtime";
import { submitS3StaticDeploy } from "./s3-static-deploy";
import { submitS3StaticExactArtifactRun } from "./s3-static-exact-run";
import { submitS3StaticProvisionOnly } from "./s3-static-provision-only";
import {
  queueFrozenProviderSubmission,
  requireFrozenProviderSubmissionAdmission,
  requireFrozenProviderReplaySource,
  requireFrozenProviderSnapshot,
} from "./deployment-provider-frozen-snapshot";
import {
  buildS3StaticControlPlaneSnapshot,
  type S3StaticControlPlaneSnapshot as Snapshot,
} from "./s3-static-control-plane-snapshot";
import { reviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";

export const S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "s3-static-control-plane-submit-request@1";

export type S3StaticControlPlaneSubmitRequest = {
  schemaVersion: typeof S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: S3StaticDeployment;
  operationKind: "deploy" | "promotion" | "retry" | "rollback" | "provision_only";
  artifactDir?: string;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
};

export async function queueS3StaticControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: S3StaticControlPlaneSubmitRequest;
  objectStore?: ControlPlaneArtifactStore;
}) {
  const snapshot = await buildS3StaticControlPlaneSnapshot({
    ...opts,
    expectedCurrentRunId: (
      await reviewedCurrentStageExpectation({
        backend: opts.backend,
        deployment: opts.request.deployment,
      })
    ).expectedCurrentRunId,
  });
  return await queueFrozenProviderSubmission({
    recordsRoot: opts.recordsRoot,
    backend: opts.backend,
    snapshot,
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
  });
}

export async function executeS3StaticControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
  assertCurrentAuthority?: () => Promise<void>;
}) {
  const submission = JSON.parse(await fs.readFile(opts.submissionPath, "utf8"));
  const snapshot = JSON.parse(await fs.readFile(opts.executionSnapshotPath, "utf8")) as Snapshot;
  requireFrozenProviderSnapshot(snapshot, "s3-static");
  requireFrozenProviderSubmissionAdmission({ provider: "s3-static", submission, snapshot });
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const assertAuthority = async () => {
    await lock.assertCurrentAuthority();
    await opts.assertCurrentAuthority?.();
  };
  const persistSubmissionStatus = async (nextSubmission: Record<string, unknown>) => {
    await assertAuthority();
    await writeControlPlaneJson(opts.submissionPath, nextSubmission);
    await writeBackendSubmissionDoc(opts.backend, nextSubmission as any, {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    });
  };
  const runningSubmission = { ...submission, lifecycleState: "running", workerId: opts.workerId };
  try {
    await persistSubmissionStatus(runningSubmission);
    const result = await withFrozenProviderWorkerSecretRuntime(
      { workspaceRoot: opts.workspaceRoot, deployment: snapshot.deployment },
      async () =>
        snapshot.operationKind === "deploy"
          ? await submitS3StaticDeploy({
              workspaceRoot: snapshot.workspaceRoot,
              deployment: snapshot.deployment,
              artifactDir: "",
              ...(snapshot.artifact ? { artifact: snapshot.artifact } : {}),
              ...(snapshot.admittedContext
                ? { admittedContext: snapshot.admittedContext as any }
                : {}),
              recordsRoot: snapshot.recordsRoot,
              submissionId: snapshot.submissionId,
              ...(snapshot.expectedSourceRevision
                ? { expectedSourceRevision: snapshot.expectedSourceRevision }
                : {}),
              ...(snapshot.smokeConnectOverride
                ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
                : {}),
            })
          : snapshot.operationKind === "provision_only"
            ? await submitS3StaticProvisionOnly({
                workspaceRoot: snapshot.workspaceRoot,
                deployment: snapshot.deployment,
                recordsRoot: snapshot.recordsRoot,
                submissionId: snapshot.submissionId,
                ...(snapshot.admittedContext
                  ? { admittedContext: snapshot.admittedContext as any }
                  : {}),
                ...(snapshot.expectedSourceRevision
                  ? { expectedSourceRevision: snapshot.expectedSourceRevision }
                  : {}),
              })
            : await (async () => {
                const source = requireFrozenProviderReplaySource(snapshot, "s3-static");
                const operationKind =
                  snapshot.operationKind === "promotion" &&
                  source.replaySnapshot.deployment.deploymentId === snapshot.deployment.deploymentId
                    ? "retry"
                    : snapshot.operationKind;
                if (operationKind === "promotion") {
                  await assertCrossDeploymentExactPromotionEligible({
                    workspaceRoot: snapshot.workspaceRoot,
                    deployment: snapshot.deployment,
                    recordsRoot: snapshot.recordsRoot,
                    backendDatabaseUrl: opts.backend.databaseUrl,
                    source,
                  });
                }
                return await submitS3StaticExactArtifactRun({
                  workspaceRoot: snapshot.workspaceRoot,
                  deployment: snapshot.deployment,
                  recordsRoot: snapshot.recordsRoot,
                  operationKind,
                  artifact: source.replaySnapshot.artifact,
                  sourceRecord: source.record,
                  parentRunId: snapshot.parentRunId as string,
                  releaseLineageId: snapshot.releaseLineageId as string,
                  artifactLineageId: snapshot.artifactLineageId as string,
                  submissionId: snapshot.submissionId,
                  ...(snapshot.admittedContext
                    ? { admittedContext: snapshot.admittedContext as any }
                    : {}),
                  ...(snapshot.expectedSourceRevision
                    ? { expectedSourceRevision: snapshot.expectedSourceRevision }
                    : {}),
                  ...(snapshot.smokeConnectOverride
                    ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
                    : {}),
                });
              })(),
    );
    result.record.controlPlane = {
      submissionId: snapshot.submissionId,
      workerId: opts.workerId,
      admission: "admitted",
      lockScope: snapshot.lockScope,
      fencingToken: lock.fencingToken,
    };
    await assertAuthority();
    await writeBackendDeployRecordDoc(opts.backend, result.record, result.recordPath, {
      expectedCurrentRunId: snapshot.expectedCurrentRunId,
    });
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
