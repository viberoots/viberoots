#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import type { CloudflareContainersDeployment } from "./contract";
import { submitCloudflareContainersDeploy } from "./cloudflare-containers-deploy";
import type { CloudflareContainersSmokeConnectOverride } from "./cloudflare-containers-routing-smoke";
import { admitKubernetesComponentArtifacts } from "./kubernetes-artifacts";
import {
  admitProviderControlPlaneSnapshot,
  queueFrozenProviderSubmission,
  requireFrozenProviderSnapshot,
  requireFrozenProviderSubmissionAdmission,
  type FrozenProviderSnapshotFields,
} from "./deployment-provider-frozen-snapshot";
import { reviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";
import { requestedReviewedSourceFromEvidence } from "./deployment-source-revision";
import {
  acquireBackendControlPlaneLock,
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import type { DeploymentServiceClientSelectionEvidence } from "./deployment-service-client-selection";

export const CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "cloudflare-containers-control-plane-submit-request@1";

export type CloudflareContainersControlPlaneSubmitRequest = {
  schemaVersion: typeof CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: CloudflareContainersDeployment;
  operationKind: "deploy";
  artifactDir: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: CloudflareContainersSmokeConnectOverride;
  controlPlaneSelection?: DeploymentServiceClientSelectionEvidence;
};

type Snapshot = FrozenProviderSnapshotFields & {
  schemaVersion: "cloudflare-containers-control-plane-snapshot@1";
  submissionId: string;
  submittedAt: string;
  operationKind: "deploy";
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: CloudflareContainersDeployment;
  workspaceRoot: string;
  recordsRoot: string;
  artifactDir: string;
  smokeConnectOverride?: CloudflareContainersSmokeConnectOverride;
};

export async function queueCloudflareContainersControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: CloudflareContainersControlPlaneSubmitRequest;
}) {
  const snapshot = await buildSnapshot({
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
  });
}

async function buildSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  request: CloudflareContainersControlPlaneSubmitRequest;
  expectedCurrentRunId?: string | null;
}): Promise<Snapshot> {
  const [artifact] = await admitKubernetesComponentArtifacts({
    recordsRoot: opts.recordsRoot,
    artifactPathsByComponentId: { default: opts.request.artifactDir },
    deploymentId: opts.request.deployment.deploymentId,
    submissionId: opts.request.submissionId,
  });
  if (!artifact) throw new Error("missing admitted cloudflare-containers artifact");
  const requestedReviewedSource = requestedReviewedSourceFromEvidence(
    opts.request.admissionEvidence,
  );
  const admittedContext = {
    source: {
      mode: "reviewed_source_ref",
      sourceRevision: requestedReviewedSource?.revision || "unknown",
      ...(requestedReviewedSource?.ref ? { sourceRef: requestedReviewedSource.ref } : {}),
      artifactIdentity: artifact.identity,
    },
    targetEnvironment: {
      providerTargetIdentity: opts.request.deployment.providerTarget.providerTargetIdentity,
    },
  };
  return {
    schemaVersion: "cloudflare-containers-control-plane-snapshot@1",
    submissionId: opts.request.submissionId,
    submittedAt: opts.request.submittedAt,
    operationKind: "deploy",
    deploymentId: opts.request.deployment.deploymentId,
    deploymentLabel: opts.request.deployment.label,
    providerTargetIdentity: opts.request.deployment.providerTarget.providerTargetIdentity,
    lockScope: opts.request.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.request.deployment,
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    artifactDir: opts.request.artifactDir,
    ...(opts.request.smokeConnectOverride
      ? { smokeConnectOverride: opts.request.smokeConnectOverride }
      : {}),
    ...(await admitProviderControlPlaneSnapshot({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind: "deploy",
      admittedContext,
      artifactLineageId: artifact.identity,
      evidence: opts.request.admissionEvidence as any,
      expectedCurrentRunId: opts.expectedCurrentRunId,
    })),
  };
}

export async function executeCloudflareContainersControlPlaneSubmission(opts: {
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
  requireFrozenProviderSnapshot(snapshot, "cloudflare-containers");
  requireFrozenProviderSubmissionAdmission({
    provider: "cloudflare-containers",
    submission,
    snapshot,
  });
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const persist = async (next: Record<string, unknown>) => {
    await lock.assertCurrentAuthority();
    await opts.assertCurrentAuthority?.();
    await writeControlPlaneJson(opts.submissionPath, next);
    await writeBackendSubmissionDoc(opts.backend, next as any, {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    });
  };
  await persist({ ...submission, lifecycleState: "running", workerId: opts.workerId });
  const result = await submitCloudflareContainersDeploy({
    workspaceRoot: snapshot.workspaceRoot,
    deployment: snapshot.deployment,
    recordsRoot: snapshot.recordsRoot,
    artifactDir: snapshot.artifactDir,
    ...(snapshot.smokeConnectOverride
      ? { smokeConnectOverride: snapshot.smokeConnectOverride }
      : {}),
  });
  result.record.controlPlane = {
    submissionId: snapshot.submissionId,
    workerId: opts.workerId,
    admission: "admitted",
    lockScope: snapshot.lockScope,
    fencingToken: lock.fencingToken,
  };
  await lock.assertCurrentAuthority();
  await opts.assertCurrentAuthority?.();
  await writeBackendDeployRecordDoc(opts.backend, result.record, result.recordPath, {
    expectedCurrentRunId: snapshot.expectedCurrentRunId,
  });
  await persist({
    ...submission,
    lifecycleState: "finished",
    completedAt: new Date().toISOString(),
    deployRunId: result.record.deployRunId,
    finalOutcome: result.record.finalOutcome,
  });
}
