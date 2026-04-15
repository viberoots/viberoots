#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { KubernetesDeployment } from "./contract.ts";
import { assertCrossDeploymentExactPromotionEligible } from "./deployment-provider-promotion.ts";
import {
  enqueueBackendSubmission,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  acquireBackendControlPlaneLock,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import {
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { submitResponseFromSubmission } from "./deployment-control-plane-status.ts";
import { submitKubernetesDeploy } from "./kubernetes-deploy.ts";
import { submitKubernetesExactArtifactRun } from "./kubernetes-exact-run.ts";
import { submitKubernetesProvisionOnly } from "./kubernetes-provision-only.ts";
import { resolveKubernetesReplaySource } from "./kubernetes-replay.ts";

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
  sourceRunId?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
};

type Snapshot = {
  schemaVersion: "kubernetes-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: KubernetesControlPlaneSubmitRequest["operationKind"];
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: KubernetesDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
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
  const snapshot: Snapshot = {
    schemaVersion: "kubernetes-control-plane-snapshot@1",
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
    ...(opts.request.artifactDirsByComponentId
      ? { artifactDirsByComponentId: opts.request.artifactDirsByComponentId }
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
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  try {
    await persistSubmissionStatus({
      ...submission,
      lifecycleState: "running",
      workerId: opts.workerId,
    });
    const result =
      snapshot.operationKind === "deploy"
        ? await submitKubernetesDeploy({
            workspaceRoot: snapshot.workspaceRoot,
            deployment: snapshot.deployment,
            recordsRoot: snapshot.recordsRoot,
            ...(snapshot.artifactDirsByComponentId
              ? { artifactDirsByComponentId: snapshot.artifactDirsByComponentId }
              : { artifactDir: String(snapshot.artifactDir || "") }),
            ...(snapshot.admissionEvidence
              ? { admissionEvidence: snapshot.admissionEvidence as any }
              : {}),
            ...(snapshot.smokeConnectOverride
              ? { smokeConnectOverride: snapshot.smokeConnectOverride as any }
              : {}),
          })
        : snapshot.operationKind === "provision_only"
          ? await submitKubernetesProvisionOnly({
              workspaceRoot: snapshot.workspaceRoot,
              deployment: snapshot.deployment,
              recordsRoot: snapshot.recordsRoot,
              ...(snapshot.admissionEvidence
                ? { admissionEvidence: snapshot.admissionEvidence as any }
                : {}),
            })
          : await (async () => {
              const source = await resolveKubernetesReplaySource({
                recordsRoot: snapshot.recordsRoot,
                deployRunId: String(snapshot.sourceRunId || ""),
              });
              if (snapshot.operationKind === "promotion") {
                await assertCrossDeploymentExactPromotionEligible({
                  workspaceRoot: snapshot.workspaceRoot,
                  deployment: snapshot.deployment,
                  source,
                });
              }
              return await submitKubernetesExactArtifactRun({
                workspaceRoot: snapshot.workspaceRoot,
                deployment: snapshot.deployment,
                recordsRoot: snapshot.recordsRoot,
                operationKind:
                  snapshot.operationKind === "promotion" &&
                  source.replaySnapshot.deployment.deploymentId === snapshot.deployment.deploymentId
                    ? "retry"
                    : snapshot.operationKind,
                componentArtifacts: source.replaySnapshot.componentArtifacts,
                sourceRecord: source.record,
                parentRunId: source.record.deployRunId,
                releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
                artifactLineageId:
                  source.record.artifactLineageId || source.replaySnapshot.artifactIdentity,
                ...(snapshot.admissionEvidence
                  ? { admissionEvidence: snapshot.admissionEvidence as any }
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
  } finally {
    await lock.release();
  }
}
