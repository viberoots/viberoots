#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import {
  type CloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesControlPlaneSubmission,
} from "./cloudflare-pages-control-plane-contract.ts";
import {
  createCloudflarePagesAdmittedTerminalSubmission,
  createCloudflarePagesControlPlaneSubmission,
  createCloudflarePagesLockConflictSubmission,
} from "./cloudflare-pages-control-plane-submission.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  lockWaitAbortReasonForSubmission,
  queueSubmissionForLock,
} from "./deployment-control-plane-queue.ts";
import { revalidateControlPlaneAdmission } from "./deployment-control-plane-revalidation.ts";
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
  hooks?: {
    afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
    onLockAcquired?: () => Promise<void> | void;
  },
) {
  const admissionReason =
    deployment.protectionClass === "production_facing" ? "production_facing" : "shared_nonprod";
  const workerId = `${snapshot.submissionId}-worker`;
  const executionSnapshotPath = executionSnapshotPathFor(recordsRoot, snapshot.submissionId);
  const submissionPath = submissionPathFor(recordsRoot, snapshot.submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  let submission = createCloudflarePagesControlPlaneSubmission(
    deployment,
    snapshot,
    executionSnapshotPath,
    {
      admission: { decision: "admitted", reason: admissionReason },
      lifecycleState: "queued",
      dedupe: meta.dedupe,
      requestedBy: meta.requestedBy,
      authorization: meta.authorization,
    },
  );
  submission = await queueSubmissionForLock({
    recordsRoot,
    submissionPath,
    snapshot,
    submission,
  });
  let lock: Awaited<ReturnType<typeof acquireControlPlaneLock>> | undefined;
  try {
    lock = await acquireControlPlaneLock(recordsRoot, snapshot.lockScope, {
      shouldAbort: async () => await lockWaitAbortReasonForSubmission(submissionPath),
    });
  } catch (error) {
    if (
      (error as any)?.code === "cancelled" ||
      (error as any)?.code === "superseded" ||
      (error as any)?.code === "no_longer_admitted"
    ) {
      const terminationReason = (error as any).code;
      const ended = createCloudflarePagesAdmittedTerminalSubmission(
        deployment,
        snapshot,
        executionSnapshotPath,
        {
          terminationReason,
          dedupe: meta.dedupe,
          requestedBy: meta.requestedBy,
          authorization: meta.authorization,
        },
      );
      await writeControlPlaneJson(submissionPath, ended);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: ended,
        submissionPath,
        executionSnapshotPath,
      });
    }
    if ((error as any)?.code === "lock_timeout") {
      const timedOut = createCloudflarePagesAdmittedTerminalSubmission(
        deployment,
        snapshot,
        executionSnapshotPath,
        {
          terminationReason: "lock_timeout",
          dedupe: meta.dedupe,
          requestedBy: meta.requestedBy,
          authorization: meta.authorization,
        },
      );
      await writeControlPlaneJson(submissionPath, timedOut);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: timedOut,
        submissionPath,
        executionSnapshotPath,
      });
    }
    const rejected = createCloudflarePagesLockConflictSubmission(
      deployment,
      snapshot,
      executionSnapshotPath,
      {
        dedupe: meta.dedupe,
        requestedBy: meta.requestedBy,
        authorization: meta.authorization,
      },
    );
    await writeControlPlaneJson(submissionPath, rejected);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission: rejected,
      submissionPath,
      executionSnapshotPath,
    });
  }
  submission = {
    ...submission,
    workerId,
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
    if (snapshot.admittedContext) {
      await revalidateControlPlaneAdmission({
        workspaceRoot: snapshot.paths.workspaceRoot,
        deployment,
        admittedContext: snapshot.admittedContext,
      }).catch(async (error) => {
        if (error instanceof Error && (error as any).code === "no_longer_admitted") {
          const noLongerAdmitted = {
            ...latestSubmission,
            lifecycleState: "finished" as const,
            terminationReason: "no_longer_admitted" as const,
            completedAt: new Date().toISOString(),
          };
          await writeControlPlaneJson(submissionPath, noLongerAdmitted);
          throw Object.assign(error, {
            submission: noLongerAdmitted,
            submissionPath,
            executionSnapshotPath,
          });
        }
        throw error;
      });
    }
    const result = await execute({
      kind: "control-plane-worker",
      submissionId: snapshot.submissionId,
      submissionPath,
      workerId: submission.workerId || workerId,
      lockScope: snapshot.lockScope,
      ...(lock?.fencingToken ? { fencingToken: lock.fencingToken } : {}),
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
    if ((error as any)?.submission) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: (error as any).submission,
      });
    }
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
    await lock?.release();
  }
}
