#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesControlPlaneSubmission,
} from "./cloudflare-pages-control-plane-contract.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";

export function createCloudflarePagesSubmissionId(): string {
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

type RunHooks = {
  afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
  onLockAcquired?: () => Promise<void> | void;
};

function createSubmission(
  deployment: CloudflarePagesDeployment,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    admission: CloudflarePagesControlPlaneSubmission["admission"];
    lifecycleState: CloudflarePagesControlPlaneSubmission["lifecycleState"];
    dedupe: DeploymentControlPlaneRequestDedupe;
    workerId?: string;
    completedAt?: string;
    terminationReason?: CloudflarePagesControlPlaneSubmission["terminationReason"];
    deployRunId?: string;
    resultRecordPath?: string;
    finalOutcome?: string;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorizationDecision;
    rejectionCode?: CloudflarePagesControlPlaneSubmission["rejectionCode"];
    pendingReasonCode?: CloudflarePagesControlPlaneSubmission["pendingReasonCode"];
  },
): CloudflarePagesControlPlaneSubmission {
  return {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA,
    submissionId: snapshot.submissionId,
    submittedAt: snapshot.submittedAt,
    operationKind: snapshot.operationKind,
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    providerTargetIdentity: snapshot.providerTargetIdentity,
    lockScope: snapshot.lockScope,
    executionSnapshotPath,
    lifecycleState: opts.lifecycleState,
    terminationReason: opts.terminationReason ?? null,
    dedupe: opts.dedupe,
    ...(opts.workerId ? { workerId: opts.workerId } : {}),
    ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
    ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
    ...(opts.resultRecordPath ? { resultRecordPath: opts.resultRecordPath } : {}),
    ...(opts.finalOutcome ? { finalOutcome: opts.finalOutcome } : {}),
    ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
    ...(opts.rejectionCode ? { rejectionCode: opts.rejectionCode } : {}),
    ...(opts.pendingReasonCode ? { pendingReasonCode: opts.pendingReasonCode } : {}),
    admission: opts.admission,
  };
}

export async function withCloudflarePagesControlPlaneRun(
  deployment: CloudflarePagesDeployment,
  recordsRoot: string,
  snapshot: CloudflarePagesControlPlaneSnapshot,
  execute: (authority: {
    kind: "control-plane-worker";
    submissionId: string;
    submissionPath: string;
    workerId: string;
    lockScope: string;
    executionSnapshotPath: string;
  }) => Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }>,
  meta: {
    dedupe: DeploymentControlPlaneRequestDedupe;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorizationDecision;
  },
  hooks?: RunHooks,
) {
  const executionSnapshotPath = executionSnapshotPathFor(recordsRoot, snapshot.submissionId);
  const submissionPath = submissionPathFor(recordsRoot, snapshot.submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  let submission = createSubmission(deployment, snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: admissionReasonFor(deployment) },
    lifecycleState: "queued",
    dedupe: meta.dedupe,
    requestedBy: meta.requestedBy,
    authorization: meta.authorization,
  });
  await writeControlPlaneJson(submissionPath, submission);
  submission = { ...submission, lifecycleState: "waiting_for_lock" };
  await writeControlPlaneJson(submissionPath, submission);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLock(recordsRoot, snapshot.lockScope);
  } catch (error) {
    const rejected = createSubmission(deployment, snapshot, executionSnapshotPath, {
      admission: { decision: "rejected", reason: "lock_conflict" },
      lifecycleState: "finished",
      completedAt: new Date().toISOString(),
      dedupe: meta.dedupe,
      requestedBy: meta.requestedBy,
      authorization: meta.authorization,
      rejectionCode: "lock_conflict",
    });
    await writeControlPlaneJson(submissionPath, rejected);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission: rejected,
      submissionPath,
      executionSnapshotPath,
    });
  }
  submission = {
    ...submission,
    workerId: createWorkerId(snapshot.submissionId),
    lifecycleState: "running",
  };
  await writeControlPlaneJson(submissionPath, submission);
  try {
    await hooks?.onLockAcquired?.();
    const latestSubmission =
      await readControlPlaneJson<CloudflarePagesControlPlaneSubmission>(submissionPath);
    if (
      latestSubmission.lifecycleState === "cancelled" ||
      latestSubmission.lifecycleState === "cancelling"
    ) {
      const cancelled = {
        ...latestSubmission,
        lifecycleState: "cancelled" as const,
        terminationReason: "cancelled" as const,
        completedAt: new Date().toISOString(),
      };
      await writeControlPlaneJson(submissionPath, cancelled);
      throw Object.assign(new Error("shared control-plane run cancelled before mutation"), {
        submission: cancelled,
        submissionPath,
        executionSnapshotPath,
      });
    }
    const result = await execute({
      kind: "control-plane-worker",
      submissionId: snapshot.submissionId,
      submissionPath,
      workerId: submission.workerId || createWorkerId(snapshot.submissionId),
      lockScope: snapshot.lockScope,
      executionSnapshotPath,
    });
    submission = {
      ...submission,
      deployRunId: result.record.deployRunId,
      completedAt: new Date().toISOString(),
      lifecycleState: "finished",
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
      lifecycleState: "finished",
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.deployRunId
        ? { deployRunId: (error as any).record.deployRunId }
        : {}),
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
