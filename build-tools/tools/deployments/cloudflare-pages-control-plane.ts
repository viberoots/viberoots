#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  resolveInitialCloudflarePagesAdmittedContext,
  resolvePromotionCloudflarePagesAdmittedContext,
} from "./cloudflare-pages-admission.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type CloudflarePagesControlPlaneOperationKind,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesPublishBehavior,
  type CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract.ts";
import {
  createCloudflarePagesSubmissionId,
  withCloudflarePagesControlPlaneRun,
} from "./cloudflare-pages-control-plane-shared.ts";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import {
  admitStaticWebappArtifact,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts.ts";

type PromotionSourceSelection = {
  record: { deployRunId: string; deploymentId: string };
  recordPath: string;
  replaySnapshotPath: string;
};

type SubmitOpts = {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  deployBatchId?: string;
  artifactDir?: string;
  artifact?: AdmittedStaticWebappArtifact;
  operationKind?: CloudflarePagesControlPlaneOperationKind;
  publishBehavior?: CloudflarePagesPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source?: PromotionSourceSelection;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
};

async function createSnapshot(
  opts: SubmitOpts,
  submissionId: string,
): Promise<CloudflarePagesControlPlaneSnapshot> {
  const operationKind = opts.operationKind || "deploy";
  const publishBehavior = opts.publishBehavior || "deploy";
  if (operationKind === "promotion" && !opts.source) {
    throw new Error("cloudflare-pages promotion requires source run evidence");
  }
  if (!opts.artifact && !opts.artifactDir) {
    throw new Error(`cloudflare-pages ${operationKind} submission requires exact artifact input`);
  }
  const artifact =
    opts.artifact ||
    (await admitStaticWebappArtifact({
      recordsRoot: opts.recordsRoot,
      artifactDir: path.resolve(opts.artifactDir || ""),
    }));
  const admittedContext = opts.source
    ? await resolvePromotionCloudflarePagesAdmittedContext({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        artifactIdentity: artifact.identity,
        sourceRecord: opts.source.record,
      })
    : await resolveInitialCloudflarePagesAdmittedContext({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        artifactIdentity: artifact.identity,
      });
  const lockScope = opts.deployment.providerTarget.providerTargetIdentity;
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: lockScope,
    lockScope,
    deployment: opts.deployment,
    admittedContext,
    paths: {
      workspaceRoot: path.resolve(opts.workspaceRoot),
      recordsRoot: path.resolve(opts.recordsRoot),
    },
    action: {
      kind: "deploy",
      publishBehavior,
      publishInput: {
        kind: "exact-artifact",
        artifact,
      },
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
      ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
      ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
      ...(opts.source ? { sourceRecordPath: opts.source.recordPath } : {}),
      ...(opts.source ? { sourceReplaySnapshotPath: opts.source.replaySnapshotPath } : {}),
    },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}

async function runWorker(opts: {
  executionSnapshotPath: string;
  submissionPath: string;
  workerId: string;
}): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const snapshot = await readControlPlaneJson<CloudflarePagesControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  if (snapshot.action.kind !== "deploy") {
    throw new Error(
      `cloudflare-pages control-plane worker does not support action ${snapshot.action.kind}`,
    );
  }
  return await runCloudflarePagesStaticDeploy({
    workspaceRoot: snapshot.paths.workspaceRoot,
    deployment: snapshot.deployment,
    artifact: snapshot.action.publishInput.artifact,
    recordsRoot: snapshot.paths.recordsRoot,
    operationKind: snapshot.operationKind,
    admittedContext: snapshot.admittedContext,
    ...(snapshot.action.parentRunId ? { parentRunId: snapshot.action.parentRunId } : {}),
    ...(snapshot.action.releaseLineageId
      ? { releaseLineageId: snapshot.action.releaseLineageId }
      : {}),
    ...(snapshot.action.artifactLineageId
      ? { artifactLineageId: snapshot.action.artifactLineageId }
      : {}),
    ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
    ...(snapshot.action.publishMode ? { publishMode: snapshot.action.publishMode } : {}),
    ...(snapshot.action.effectiveRunTarget
      ? { effectiveRunTarget: snapshot.action.effectiveRunTarget }
      : {}),
    ...(snapshot.action.previewIdentitySelector
      ? { previewIdentitySelector: snapshot.action.previewIdentitySelector }
      : {}),
    authority: {
      kind: "control-plane-worker",
      submissionId: snapshot.submissionId,
      submissionPath: opts.submissionPath,
      workerId: opts.workerId,
      lockScope: snapshot.lockScope,
      executionSnapshotPath: opts.executionSnapshotPath,
    },
    ...(snapshot.smokeConnectOverride
      ? { smokeConnectOverride: snapshot.smokeConnectOverride }
      : {}),
  });
}

export async function submitCloudflarePagesControlPlaneDeploy(opts: SubmitOpts): Promise<{
  submission: {
    submissionId: string;
    submittedAt: string;
    operationKind: CloudflarePagesControlPlaneSnapshot["operationKind"];
    deploymentId: string;
    deploymentLabel: string;
    providerTargetIdentity: string;
    lockScope: string;
    executionSnapshotPath: string;
    workerId?: string;
    resultRecordPath?: string;
    finalOutcome?: string;
    admission: { decision: "admitted" | "rejected"; reason: string };
    completedAt?: string;
  };
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: CloudflarePagesDeployRecord;
  recordPath: string;
}> {
  const submissionId = createCloudflarePagesSubmissionId();
  const snapshot = await createSnapshot(opts, submissionId);
  return await withCloudflarePagesControlPlaneRun(
    opts.deployment,
    opts.recordsRoot,
    snapshot,
    async (authority) =>
      await runWorker({
        executionSnapshotPath: authority.executionSnapshotPath,
        submissionPath: authority.submissionPath,
        workerId: authority.workerId,
      }),
  );
}
