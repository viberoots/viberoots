#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import { resolveInitialCloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesSmokeConnectOverride,
  type CloudflarePagesControlPlaneSubmission,
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
import { admitStaticWebappArtifact } from "./static-webapp-artifacts.ts";

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
    admittedContext: snapshot.admittedContext,
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

export async function submitCloudflarePagesControlPlaneDeploy(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactDir: string;
  recordsRoot: string;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
}): Promise<{
  submission: CloudflarePagesControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: CloudflarePagesDeployRecord;
  recordPath: string;
}> {
  const submissionId = createSubmissionId();
  const submittedAt = new Date().toISOString();
  const artifact = await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir: path.resolve(opts.artifactDir),
  });
  const admittedContext = await resolveInitialCloudflarePagesAdmittedContext({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactIdentity: artifact.identity,
  });
  const lockScope = opts.deployment.providerTarget.providerTargetIdentity;
  const snapshot: CloudflarePagesControlPlaneSnapshot = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt,
    operationKind: "deploy",
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
      publishInput: {
        kind: "exact-artifact",
        artifact,
      },
    },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
  const executionSnapshotPath = executionSnapshotPathFor(opts.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLock(opts.recordsRoot, lockScope);
  } catch (error) {
    const rejected: CloudflarePagesControlPlaneSubmission = {
      schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
      submissionId,
      submittedAt,
      operationKind: "deploy",
      deploymentId: opts.deployment.deploymentId,
      deploymentLabel: opts.deployment.label,
      providerTargetIdentity: lockScope,
      lockScope,
      executionSnapshotPath,
      admission: { decision: "rejected", reason: "lock_conflict" },
    };
    await writeControlPlaneJson(submissionPath, rejected);
    throw error;
  }
  let submission: CloudflarePagesControlPlaneSubmission = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId,
    submittedAt,
    operationKind: "deploy",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: lockScope,
    lockScope,
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
      lockScope,
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
