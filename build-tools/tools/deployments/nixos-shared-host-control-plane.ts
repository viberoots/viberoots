#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostControlPlaneSubmission,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import { runNixosSharedHostExplicitRemoval } from "./nixos-shared-host-explicit-removal.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

type SubmitHooks = {
  afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
  onLockAcquired?: () => Promise<void> | void;
};

type SubmitOpts = {
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  artifactDir?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  hooks?: SubmitHooks;
};

type SubmitResult = {
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: NixosSharedHostDeployRecord;
  recordPath: string;
};

function createSubmissionId(): string {
  return `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function createWorkerId(submissionId: string): string {
  return `${submissionId}-worker`;
}

function createSnapshot(
  opts: SubmitOpts,
  submissionId: string,
): NixosSharedHostControlPlaneSnapshot {
  const submittedAt = new Date().toISOString();
  const lockScope = opts.deployment.providerTarget.sharedDevTargetIdentity;
  if (opts.operationKind === "deploy" && !opts.artifactDir) {
    throw new Error("shared control-plane deploy submission requires artifactDir");
  }
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt,
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.sharedDevTargetIdentity,
    lockScope,
    deployment: opts.deployment,
    paths: {
      statePath: path.resolve(opts.paths.statePath),
      hostRoot: path.resolve(opts.paths.hostRoot),
      recordsRoot: path.resolve(opts.paths.recordsRoot),
      ...(opts.paths.hostConfigPath
        ? { hostConfigPath: path.resolve(opts.paths.hostConfigPath) }
        : {}),
    },
    action:
      opts.operationKind === "deploy"
        ? { kind: "deploy", artifactDir: path.resolve(opts.artifactDir || "") }
        : { kind: "explicit_removal" },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  };
}

function createSubmission(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  executionSnapshotPath: string,
  admission: NixosSharedHostControlPlaneSubmission["admission"],
  workerId?: string,
): NixosSharedHostControlPlaneSubmission {
  return {
    schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId: snapshot.submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: snapshot.deploymentId,
    deploymentLabel: snapshot.deploymentLabel,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    executionSnapshotPath,
    ...(workerId ? { workerId } : {}),
    admission,
  };
}

async function runWorker(opts: {
  submissionPath: string;
  executionSnapshotPath: string;
  workerId: string;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  const authority = {
    kind: "control-plane-worker" as const,
    submissionId: snapshot.submissionId,
    submissionPath: opts.submissionPath,
    workerId: opts.workerId,
    lockScope: snapshot.lockScope,
    executionSnapshotPath: opts.executionSnapshotPath,
  };
  return snapshot.action.kind === "deploy"
    ? await runNixosSharedHostStaticDeploy({
        deployment: snapshot.deployment,
        artifactDir: snapshot.action.artifactDir,
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        ...(snapshot.smokeConnectOverride
          ? { smokeConnectOverride: snapshot.smokeConnectOverride }
          : {}),
        authority,
      })
    : await runNixosSharedHostExplicitRemoval({
        deployment: snapshot.deployment,
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        authority,
      });
}

export async function submitNixosSharedHostControlPlaneRun(
  opts: SubmitOpts,
): Promise<SubmitResult> {
  const submissionId = createSubmissionId();
  const snapshot = createSnapshot(opts, submissionId);
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await opts.hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLock(opts.paths.recordsRoot, snapshot.lockScope);
  } catch (error) {
    const rejected = createSubmission(snapshot, executionSnapshotPath, {
      decision: "rejected",
      reason: "lock_conflict",
    });
    await writeControlPlaneJson(submissionPath, rejected);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission: rejected,
      submissionPath,
      executionSnapshotPath,
    });
  }
  const workerId = createWorkerId(submissionId);
  let submission = createSubmission(
    snapshot,
    executionSnapshotPath,
    { decision: "admitted", reason: "shared_nonprod" },
    workerId,
  );
  await writeControlPlaneJson(submissionPath, submission);
  try {
    await opts.hooks?.onLockAcquired?.();
    const result = await runWorker({ submissionPath, executionSnapshotPath, workerId });
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
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission,
      submissionPath,
      executionSnapshotPath,
    });
  } finally {
    await releaseLock?.();
  }
}
