#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import {
  resolveInitialCloudflarePagesAdmittedContext,
  resolvePromotionCloudflarePagesAdmittedContext,
} from "./cloudflare-pages-admission.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type CloudflarePagesControlPlaneOperationKind,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesControlPlaneSubmission,
  type CloudflarePagesPublishBehavior,
  type CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract.ts";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
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

function createSubmissionId(): string {
  return `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}
function createWorkerId(submissionId: string): string {
  return `${submissionId}-worker`;
}

function admissionReasonFor(
  deployment: CloudflarePagesDeployment,
): "shared_nonprod" | "production_facing" {
  return deployment.protectionClass === "production_facing"
    ? "production_facing"
    : "shared_nonprod";
}

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
  submission: CloudflarePagesControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: CloudflarePagesDeployRecord;
  recordPath: string;
}> {
  const submissionId = createSubmissionId();
  const snapshot = await createSnapshot(opts, submissionId);
  const executionSnapshotPath = executionSnapshotPathFor(opts.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLock(opts.recordsRoot, snapshot.lockScope);
  } catch (error) {
    const rejected: CloudflarePagesControlPlaneSubmission = {
      schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
      submissionId,
      submittedAt: snapshot.submittedAt,
      operationKind: snapshot.operationKind,
      deploymentId: opts.deployment.deploymentId,
      deploymentLabel: opts.deployment.label,
      providerTargetIdentity: snapshot.lockScope,
      lockScope: snapshot.lockScope,
      executionSnapshotPath,
      admission: { decision: "rejected", reason: "lock_conflict" },
    };
    await writeControlPlaneJson(submissionPath, rejected);
    throw error;
  }
  let submission: CloudflarePagesControlPlaneSubmission = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: snapshot.lockScope,
    lockScope: snapshot.lockScope,
    executionSnapshotPath,
    workerId: createWorkerId(submissionId),
    admission: { decision: "admitted", reason: admissionReasonFor(opts.deployment) },
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    const result = await runWorker({
      executionSnapshotPath,
      submissionPath,
      workerId: submission.workerId || createWorkerId(submissionId),
    });
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      resultRecordPath: result.recordPath,
      finalOutcome: result.record.finalOutcome,
    };
    await writeControlPlaneJson(submissionPath, submission);
    return {
      submission,
      submissionPath,
      executionSnapshotPath,
      lockScope: snapshot.lockScope,
      record: result.record,
      recordPath: result.recordPath,
    };
  } catch (error) {
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.finalOutcome
        ? { finalOutcome: (error as any).record.finalOutcome }
        : {}),
    };
    await writeControlPlaneJson(submissionPath, submission);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { submission });
  } finally {
    await releaseLock?.();
  }
}
