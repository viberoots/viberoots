#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { KubernetesDeployment } from "./contract";
import { terminalSubmissionFromAdmissionFailure } from "./deployment-provider-control-plane-admission-failure";
import { assertCrossDeploymentExactPromotionEligible } from "./deployment-provider-promotion";
import {
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import { submitKubernetesDeploy } from "./kubernetes-deploy";
import { submitKubernetesExactArtifactRun } from "./kubernetes-exact-run";
import { submitKubernetesProvisionOnly } from "./kubernetes-provision-only";
import {
  queueFrozenProviderSubmission,
  requireFrozenProviderSubmissionAdmission,
  requireFrozenProviderReplaySource,
  requireFrozenProviderSnapshot,
} from "./deployment-provider-frozen-snapshot";
import {
  buildKubernetesControlPlaneSnapshot,
  type KubernetesControlPlaneSnapshot as Snapshot,
} from "./kubernetes-control-plane-snapshot";

export const KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "kubernetes-control-plane-submit-request@1";

export type KubernetesControlPlaneSubmitRequest = {
  schemaVersion: typeof KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: KubernetesDeployment;
  operationKind: "deploy" | "promotion" | "retry" | "rollback" | "provision_only";
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
};

export async function queueKubernetesControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: KubernetesControlPlaneSubmitRequest;
}) {
  const snapshot = await buildKubernetesControlPlaneSnapshot(opts);
  return await queueFrozenProviderSubmission({
    recordsRoot: opts.recordsRoot,
    backend: opts.backend,
    snapshot,
  });
}

export async function executeKubernetesControlPlaneSubmission(opts: {
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
  requireFrozenProviderSnapshot(snapshot, "kubernetes");
  requireFrozenProviderSubmissionAdmission({ provider: "kubernetes", submission, snapshot });
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const runningSubmission = { ...submission, lifecycleState: "running", workerId: opts.workerId };
  try {
    await persistSubmissionStatus(runningSubmission);
    const result =
      snapshot.operationKind === "deploy"
        ? await submitKubernetesDeploy({
            workspaceRoot: snapshot.workspaceRoot,
            deployment: snapshot.deployment,
            recordsRoot: snapshot.recordsRoot,
            submissionId: snapshot.submissionId,
            ...(snapshot.componentArtifacts
              ? { componentArtifacts: snapshot.componentArtifacts as any }
              : {}),
            ...(snapshot.admittedContext
              ? { admittedContext: snapshot.admittedContext as any }
              : {}),
            ...(snapshot.expectedSourceRevision
              ? { expectedSourceRevision: snapshot.expectedSourceRevision }
              : {}),
            ...(snapshot.preparedPublisherConfig
              ? { preparedPublisherConfig: snapshot.preparedPublisherConfig as any }
              : {}),
            artifactDir: "",
            ...(snapshot.smokeConnectOverride
              ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
              : {}),
          })
        : snapshot.operationKind === "provision_only"
          ? await submitKubernetesProvisionOnly({
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
              const source = requireFrozenProviderReplaySource(snapshot, "kubernetes");
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
              return await submitKubernetesExactArtifactRun({
                workspaceRoot: snapshot.workspaceRoot,
                deployment: snapshot.deployment,
                recordsRoot: snapshot.recordsRoot,
                operationKind,
                componentArtifacts: source.replaySnapshot.componentArtifacts,
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
                ...(snapshot.preparedPublisherConfig
                  ? { preparedPublisherConfig: snapshot.preparedPublisherConfig as any }
                  : {}),
                ...(snapshot.smokeConnectOverride
                  ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
                  : {}),
              });
            })();
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
