#!/usr/bin/env zx-wrapper
import path from "node:path";
import { redactOperatorText } from "./deployment-control-plane-redaction";
import {
  ageMs,
  increment,
  readJsonDir,
  readJsonFile,
  recordRefs,
} from "./deployment-control-plane-observability-helpers";

type SubmissionLike = {
  submissionId: string;
  submittedAt: string;
  deploymentId: string;
  lockScope: string;
  lifecycleState: string;
  completedAt?: string;
  rejectionCode?: string;
  pendingReasonCode?: string;
  execution?: { mutationStartedAt?: string; currentStep?: string };
  recovery?: { decision?: string };
  cancellationRequested?: { requestedAt?: string };
};

type RunLike = {
  deployRunId: string;
  deploymentId: string;
  providerTargetIdentity: string;
  finalOutcome: string;
  failedStep?: string;
  operationKind?: string;
  replaySnapshotPath?: string;
  provisionerPlan?: { artifactPath?: string };
  controlPlane?: { executionSnapshotPath?: string };
  breakGlass?: { evidencePath?: string };
  error?: string;
  errorFingerprint?: string;
};
type ResilienceLike = {
  latestBackup?: { createdAt?: string };
  latestRestoreTest?: { testedAt?: string; status?: string };
};
function submissionEvents(submission: SubmissionLike) {
  const events = [
    {
      category: "submission",
      action: submission.pendingReasonCode ? "pending_approval" : "submitted",
      occurredAt: submission.submittedAt,
      submissionId: submission.submissionId,
      deploymentId: submission.deploymentId,
    },
  ];
  if (submission.lifecycleState === "waiting_for_lock") {
    events.push({
      category: "lock",
      action: "waiting",
      occurredAt: submission.submittedAt,
      submissionId: submission.submissionId,
      deploymentId: submission.deploymentId,
    });
  }
  if (submission.execution?.mutationStartedAt) {
    events.push({
      category: "mutation",
      action: "started",
      occurredAt: submission.execution.mutationStartedAt,
      submissionId: submission.submissionId,
      deploymentId: submission.deploymentId,
      step: submission.execution.currentStep,
    });
  }
  if (submission.cancellationRequested?.requestedAt) {
    events.push({
      category: "cancellation",
      action: "requested",
      occurredAt: submission.cancellationRequested.requestedAt,
      submissionId: submission.submissionId,
      deploymentId: submission.deploymentId,
    });
  }
  if (submission.recovery?.decision && submission.completedAt) {
    events.push({
      category: "recovery",
      action: submission.recovery.decision,
      occurredAt: submission.completedAt,
      submissionId: submission.submissionId,
      deploymentId: submission.deploymentId,
    });
  }
  return events;
}
function runEvents(run: RunLike) {
  return [
    {
      category: run.operationKind === "preview_cleanup" ? "preview_cleanup" : "run",
      action: run.finalOutcome === "succeeded" ? "finished" : "failed",
      occurredAt: run.deployRunId,
      deployRunId: run.deployRunId,
      deploymentId: run.deploymentId,
      finalOutcome: run.finalOutcome,
      failedStep: run.failedStep,
    },
    ...(run.breakGlass?.evidencePath
      ? [
          {
            category: "break_glass",
            action: "invoked",
            occurredAt: run.deployRunId,
            deployRunId: run.deployRunId,
            deploymentId: run.deploymentId,
          },
        ]
      : []),
  ];
}
export async function readDeploymentControlPlaneObservability(
  recordsRoot: string,
  now = new Date(),
) {
  const resolvedRoot = path.resolve(recordsRoot);
  const submissions = await readJsonDir<SubmissionLike>(
    path.join(resolvedRoot, "control-plane", "submissions"),
  );
  const runs = await readJsonDir<RunLike>(path.join(resolvedRoot, "runs"));
  const resilience = await readJsonFile<ResilienceLike>(
    path.join(resolvedRoot, "control-plane", "resilience", "latest.json"),
  );
  const failureCountsByOutcome: Record<string, number> = {};
  const failureCountsByStep: Record<string, number> = {};
  for (const run of runs.filter((entry) => entry.finalOutcome !== "succeeded")) {
    increment(failureCountsByOutcome, run.finalOutcome);
    increment(failureCountsByStep, run.failedStep || "unknown");
  }
  const queued = submissions.filter((entry) =>
    ["pending_approval", "queued", "waiting_for_lock"].includes(entry.lifecycleState),
  );
  const running = submissions.filter((entry) =>
    ["running", "cancelling"].includes(entry.lifecycleState),
  );
  const alerts = [
    ...(failureCountsByOutcome.publish_failed >= 2
      ? [{ code: "repeated_target_failure", severity: "error" as const }]
      : []),
    ...(submissions.some((entry) => entry.rejectionCode === "lock_conflict")
      ? [{ code: "lock_contention", severity: "warn" as const }]
      : []),
    ...(running.length > 0 ? [{ code: "in_doubt_runs_present", severity: "warn" as const }] : []),
    ...(resilience?.latestRestoreTest?.status === "failed"
      ? [{ code: "restore_test_failed", severity: "error" as const }]
      : []),
  ];
  const queueAges = queued.map((entry) => ageMs(entry.submittedAt, now) || 0);
  const runningAges = running.map(
    (entry) => ageMs(entry.execution?.mutationStartedAt || entry.submittedAt, now) || 0,
  );
  return {
    schemaVersion: "deployment-control-plane-observability@1",
    generatedAt: now.toISOString(),
    events: [...submissions.flatMap(submissionEvents), ...runs.flatMap(runEvents)],
    metrics: {
      queueDepth: queued.length,
      queueWaitCount: queued.length,
      oldestQueuedAgeMs: Math.max(...queueAges, 0),
      oldestRunningAgeMs: Math.max(...runningAges, 0),
      lockContentionCount: submissions.filter((entry) => entry.rejectionCode === "lock_conflict")
        .length,
      failureCountsByOutcome,
      failureCountsByStep,
      inDoubtRunCount: running.length,
      recoveredRunCount: submissions.filter((entry) => entry.recovery?.decision).length,
      latestBackupAt: resilience?.latestBackup?.createdAt,
      latestRestoreTestAt: resilience?.latestRestoreTest?.testedAt,
      latestRestoreTestStatus: resilience?.latestRestoreTest?.status,
    },
    alerts,
    views: {
      queue: queued.map((entry) => ({
        submissionId: entry.submissionId,
        deploymentId: entry.deploymentId,
        lifecycleState: entry.lifecycleState,
        queueAgeMs: ageMs(entry.submittedAt, now) || 0,
      })),
      locks: submissions
        .filter((entry) =>
          ["waiting_for_lock", "running", "cancelling"].includes(entry.lifecycleState),
        )
        .map((entry) => ({
          lockScope: entry.lockScope,
          submissionId: entry.submissionId,
          lifecycleState: entry.lifecycleState,
        })),
      runs: await Promise.all(
        runs.map(async (run) => ({
          deployRunId: run.deployRunId,
          deploymentId: run.deploymentId,
          providerTargetIdentity: run.providerTargetIdentity,
          finalOutcome: run.finalOutcome,
          ...(run.failedStep ? { failedStep: run.failedStep } : {}),
          ...(redactOperatorText(run.error) ? { error: redactOperatorText(run.error) } : {}),
          ...(run.errorFingerprint ? { errorFingerprint: run.errorFingerprint } : {}),
          operatorArtifacts: await recordRefs(run),
        })),
      ),
      resilience: {
        latestBackupAt: resilience?.latestBackup?.createdAt,
        latestRestoreTestAt: resilience?.latestRestoreTest?.testedAt,
        latestRestoreTestStatus: resilience?.latestRestoreTest?.status || "unknown",
      },
    },
  };
}
