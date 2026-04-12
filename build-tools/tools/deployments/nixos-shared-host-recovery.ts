#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import { readBackendDeployRecordEnvelopeBySubmissionId } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";

function runsDir(recordsRoot: string): string {
  return path.join(path.resolve(recordsRoot), "runs");
}

function currentStepFor(
  submission: Pick<NixosSharedHostControlPlaneSubmission, "execution">,
): NonNullable<NixosSharedHostControlPlaneSubmission["recovery"]>["inDoubtStep"] {
  return submission.execution?.currentStep || "publish";
}

function terminalizationPathFor(
  record: Pick<NixosSharedHostDeployRecord, "finalOutcome">,
): "finished_after_reconciliation" | "failed_after_reconciliation" {
  return record.finalOutcome === "succeeded"
    ? "finished_after_reconciliation"
    : "failed_after_reconciliation";
}

async function maybeFindRecordForSubmission(
  recordsRoot: string,
  submissionId: string,
  backend?: NixosSharedHostControlPlaneBackendTarget,
): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string } | undefined> {
  if (backend) {
    const backendRecord = await readBackendDeployRecordEnvelopeBySubmissionId(
      backend,
      submissionId,
    );
    if (backendRecord) {
      return {
        record: backendRecord.record as NixosSharedHostDeployRecord,
        recordPath: backendRecord.recordPath,
      };
    }
  }
  try {
    const entries = await fsp.readdir(runsDir(recordsRoot));
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const recordPath = path.join(runsDir(recordsRoot), entry);
      const record = JSON.parse(
        await fsp.readFile(recordPath, "utf8"),
      ) as NixosSharedHostDeployRecord;
      if (record.controlPlane?.submissionId === submissionId) return { record, recordPath };
    }
  } catch {}
  return undefined;
}

function withCancellationSummary(
  submission: NixosSharedHostControlPlaneSubmission,
  record?: NixosSharedHostDeployRecord,
) {
  if (!submission.cancellationRequested) return {};
  return {
    cancellationSummary: {
      requestedAt: submission.cancellationRequested.requestedAt,
      requestedBy: submission.cancellationRequested.requestedBy,
      activeStep: currentStepFor(submission),
      mutationMayHaveStarted: !!submission.execution?.mutationStartedAt,
      enteredReconciliation: true,
      terminalizationPath: record
        ? terminalizationPathFor(record)
        : ("cancelled_without_mutation" as const),
    },
  };
}

export async function reconcileNixosSharedHostRecoveredSubmission(opts: {
  submissionPath: string;
  recordsRoot: string;
  recoveredBy?: DeploymentPrincipal;
  backend?: NixosSharedHostControlPlaneBackendTarget;
}) {
  const recoveredAt = new Date().toISOString();
  const submission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
    opts.submissionPath,
  );
  const existing = await maybeFindRecordForSubmission(
    opts.recordsRoot,
    submission.submissionId,
    opts.backend,
  );
  if (existing) {
    const updated: NixosSharedHostControlPlaneSubmission = {
      ...submission,
      lifecycleState: "finished",
      completedAt: recoveredAt,
      deployRunId: existing.record.deployRunId,
      resultRecordPath: existing.recordPath,
      finalOutcome: existing.record.finalOutcome,
      recovery: {
        occurred: true,
        inDoubtStep: currentStepFor(submission),
        providerReconciliation: "mutation_completed",
        decision: "converged_to_final_record",
        recoveredAt,
        authorityReacquired: true,
        ...(opts.recoveredBy ? { recoveredBy: opts.recoveredBy } : {}),
      },
      ...withCancellationSummary(submission, existing.record),
    };
    await writeControlPlaneJson(opts.submissionPath, updated);
    return updated;
  }
  const updated: NixosSharedHostControlPlaneSubmission = {
    ...submission,
    lifecycleState: "finished",
    completedAt: recoveredAt,
    recovery: {
      occurred: true,
      inDoubtStep: currentStepFor(submission),
      providerReconciliation: "inconclusive",
      decision: "terminated_for_operator_follow_up",
      recoveredAt,
      authorityReacquired: true,
      ...(opts.recoveredBy ? { recoveredBy: opts.recoveredBy } : {}),
    },
  };
  await writeControlPlaneJson(opts.submissionPath, updated);
  return updated;
}
