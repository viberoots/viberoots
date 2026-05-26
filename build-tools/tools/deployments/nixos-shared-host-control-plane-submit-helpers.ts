#!/usr/bin/env zx-wrapper
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import { revalidateControlPlaneAdmission } from "./deployment-control-plane-revalidation";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract";
import { createNixosSharedHostWorkerId } from "./nixos-shared-host-control-plane-snapshot-helpers";
import {
  acquireNixosSharedHostControlPlaneLocks,
  runNixosSharedHostControlPlaneWorker,
} from "./nixos-shared-host-control-plane-execution";
import { lockWaitAbortReasonForSubmission } from "./deployment-control-plane-queue";
import { lockErrorContext } from "./deployment-control-plane-lock-error";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import {
  finalizeSubmissionFromRecordedError,
  recoverControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-submit-finalize";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import { cleanupReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";
export async function executeSubmittedNixosSharedHostControlPlaneRun(opts: {
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  recordSubmissionPath?: string;
  recordExecutionSnapshotPath?: string;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  workspaceRoot: string;
  deployRunId: string;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  operationKind: string;
  deployment: any;
  onLockAcquired?: () => Promise<void> | void;
  gateEvaluator?: NixosSharedHostGateEvaluator;
  persistSubmission?: (submission: NixosSharedHostControlPlaneSubmission) => Promise<void>;
  persistRecord?: (record: NixosSharedHostDeployRecord, recordPath: string) => Promise<void>;
  assertCurrentAuthority?: () => Promise<void>;
  credentialDirectory?: import("./control-plane-credentials").ControlPlaneCredentialDirectory;
  reviewedSourceCredentials?: import("./nixos-shared-host-reviewed-source-git").ReviewedSourceCredentialFiles;
  recoverSubmission?: (args: any) => Promise<NixosSharedHostControlPlaneSubmission>;
  acquireLocks?: (args: {
    recordsRoot: string;
    deployment: any;
    shouldAbort?: () => Promise<"cancelled" | "superseded" | "no_longer_admitted" | null>;
  }) => Promise<{
    fencingToken?: string;
    assertCurrentAuthority?: () => Promise<void>;
    release: () => Promise<void>;
  }>;
}) {
  let lock: Awaited<ReturnType<typeof acquireNixosSharedHostControlPlaneLocks>> | undefined;
  const cleanupReviewedSource = async () =>
    await cleanupReviewedSourceSnapshot(opts.workspaceRoot, opts.snapshot);
  const reviewedSourceCredentials = opts.reviewedSourceCredentials;
  const assertAuthority = async () => {
    await lock?.assertCurrentAuthority?.();
    await opts.assertCurrentAuthority?.();
  };
  const writeSubmission = async (value: NixosSharedHostControlPlaneSubmission) => {
    await assertAuthority();
    await writeControlPlaneJson(opts.submissionPath, value);
    await opts.persistSubmission?.(value);
  };
  try {
    const acquireLocks =
      opts.acquireLocks ||
      (async (args: {
        recordsRoot: string;
        deployment: any;
        shouldAbort?: () => Promise<"cancelled" | "superseded" | "no_longer_admitted" | null>;
      }) =>
        await acquireNixosSharedHostControlPlaneLocks(args.recordsRoot, args.deployment, {
          ...(args.shouldAbort ? { shouldAbort: args.shouldAbort } : {}),
        }));
    lock = await acquireLocks({
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      shouldAbort: async () => await lockWaitAbortReasonForSubmission(opts.submissionPath),
    });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      ...lockErrorContext(error),
    });
  }
  const workerId = createNixosSharedHostWorkerId(opts.snapshot.submissionId);
  let submission = { ...opts.submission, workerId, lifecycleState: "running" as const };
  await writeSubmission(submission);
  try {
    await opts.onLockAcquired?.();
    await assertAuthority();
    const latestSubmission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
      opts.submissionPath,
    );
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
      await writeSubmission(cancelled);
      await cleanupReviewedSource();
      throw Object.assign(new Error("shared control-plane run cancelled before mutation"), {
        submission: cancelled,
      });
    }
    try {
      if (opts.snapshot.admittedContext) {
        await revalidateControlPlaneAdmission({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.snapshot.deployment,
          admittedContext: opts.snapshot.admittedContext,
          recordsRoot: opts.recordsRoot,
          ...(opts.backendDatabaseUrl ? { backendDatabaseUrl: opts.backendDatabaseUrl } : {}),
          ...(reviewedSourceCredentials ? { reviewedSourceCredentials } : {}),
        });
      }
    } catch (error) {
      if (
        error instanceof DeploymentAdmissionError &&
        (error.code === "no_longer_admitted" || error.code === "approval_no_longer_valid")
      ) {
        const noLongerAdmitted = {
          ...latestSubmission,
          lifecycleState: "finished" as const,
          terminationReason: "no_longer_admitted" as const,
          completedAt: new Date().toISOString(),
          ...(error.code === "approval_no_longer_valid" && latestSubmission.approval
            ? {
                approval: {
                  ...latestSubmission.approval,
                  state: "no_longer_valid" as const,
                },
              }
            : {}),
        };
        await writeSubmission(noLongerAdmitted);
        await cleanupReviewedSource();
        throw Object.assign(error, { submission: noLongerAdmitted });
      }
      throw error;
    }
    submission = {
      ...latestSubmission,
      workerId,
      lifecycleState: "running",
      execution: {
        currentStep: ["explicit_removal", "provision_only"].includes(opts.operationKind)
          ? "provision"
          : "publish",
        mutationStartedAt: new Date().toISOString(),
      },
    };
    await writeSubmission(submission);
    const result = await runNixosSharedHostControlPlaneWorker({
      submissionPath: opts.submissionPath,
      executionSnapshotPath: opts.executionSnapshotPath,
      workspaceRoot: opts.workspaceRoot,
      ...(opts.recordSubmissionPath ? { recordSubmissionPath: opts.recordSubmissionPath } : {}),
      ...(opts.recordExecutionSnapshotPath
        ? { recordExecutionSnapshotPath: opts.recordExecutionSnapshotPath }
        : {}),
      workerId,
      ...(lock?.fencingToken ? { fencingToken: lock.fencingToken } : {}),
      deployRunId: opts.deployRunId,
      progressiveRollout: submission.progressiveRollout || opts.snapshot.progressiveRollout,
      ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
      ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
    });
    await assertAuthority();
    await opts.persistRecord?.(result.record, result.recordPath);
    const latestCompleted = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
      opts.submissionPath,
    );
    const finalized =
      latestCompleted.cancellationRequested || latestCompleted.lifecycleState === "cancelling"
        ? await recoverControlPlaneSubmission({
            submissionPath: opts.submissionPath,
            recordsRoot: opts.recordsRoot,
            persistSubmission: opts.persistSubmission,
            recoverSubmission: opts.recoverSubmission,
          })
        : {
            ...submission,
            deployRunId: result.record.deployRunId,
            completedAt: new Date().toISOString(),
            lifecycleState: "finished" as const,
            resultRecordPath: result.recordPath,
            finalOutcome: result.record.finalOutcome,
            ...(result.record.progressiveRollout
              ? { progressiveRollout: result.record.progressiveRollout }
              : {}),
          };
    if (!finalized.recovery) {
      try {
        await assertAuthority();
      } catch {
        return {
          submission: await recoverControlPlaneSubmission({
            submissionPath: opts.submissionPath,
            recordsRoot: opts.recordsRoot,
            persistSubmission: opts.persistSubmission,
            recoverSubmission: opts.recoverSubmission,
          }),
          workerId,
          result,
        };
      }
      await writeSubmission(finalized);
    }
    await cleanupReviewedSource();
    return { submission: finalized, workerId, result };
  } catch (error) {
    if ((error as any)?.paused) {
      const paused = {
        ...submission,
        lifecycleState: "paused" as const,
        deployRunId: opts.deployRunId,
        progressiveRollout: (error as any).progressiveRollout,
      };
      await writeSubmission(paused);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: paused,
      });
    }
    if ((error as any)?.recordPath) {
      await assertAuthority();
      await opts.persistRecord?.((error as any).record, (error as any).recordPath);
      const finalized = finalizeSubmissionFromRecordedError(submission, opts.deployRunId, error);
      await writeSubmission(finalized);
      await cleanupReviewedSource();
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        submission: finalized,
      });
    }
    throw error;
  } finally {
    await lock?.release();
  }
}
