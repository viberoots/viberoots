#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import {
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostControlPlaneSubmission,
  type NixosSharedHostSmokeConnectOverride,
  type NixosSharedHostControlPlaneSnapshot,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";
import {
  createNixosSharedHostControlPlaneSnapshot,
  createNixosSharedHostSubmissionId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot.ts";
import { evaluateNixosSharedHostControlPlaneAdmission } from "./nixos-shared-host-control-plane-admission.ts";
import { createAdmissionFailureSubmission } from "./nixos-shared-host-control-plane-admission-failure.ts";
import { ensureNoActiveProgressiveRun } from "./nixos-shared-host-control-plane-submit-helpers.ts";
import { queueSubmissionForLock } from "./deployment-control-plane-queue.ts";
import { writeNixosSharedHostProvisionerPlan } from "./nixos-shared-host-provisioner-plan.ts";
import {
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records.ts";

export type PrepareNixosSharedHostControlPlaneRunOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  submissionId?: string;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  hooks?: {
    afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
    gateEvaluator?: NixosSharedHostGateEvaluator;
  };
};

export async function prepareNixosSharedHostControlPlaneRun(
  opts: PrepareNixosSharedHostControlPlaneRunOpts,
): Promise<{
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  deployRunId: string;
}> {
  const submissionId = opts.submissionId || createNixosSharedHostSubmissionId();
  const snapshot = await createNixosSharedHostControlPlaneSnapshot(opts, submissionId);
  const deployRunId = createNixosSharedHostDeployRunId();
  snapshot.provisionerPlan = await writeNixosSharedHostProvisionerPlan({ snapshot });
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await opts.hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  try {
    await ensureNoActiveProgressiveRun(opts.paths.recordsRoot, snapshot.lockScope, submissionId);
    await evaluateNixosSharedHostControlPlaneAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      deployment: opts.deployment,
      snapshot,
      source: opts.source,
      artifactLineageId: opts.artifactLineageId,
      admissionEvidence: opts.admissionEvidence,
    });
    if (snapshot.admittedContext) {
      await writeControlPlaneJson(executionSnapshotPath, snapshot);
    }
  } catch (error) {
    const submission = createAdmissionFailureSubmission({
      error,
      snapshot,
      executionSnapshotPath,
      dedupe: opts.dedupe,
      requestedBy: opts.requestedBy,
      authorization: opts.authorization,
    });
    if (submission) {
      await writeControlPlaneJson(submissionPath, submission);
      throw Object.assign(error, {
        submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    throw error;
  }
  let submission = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: "shared_nonprod" },
    lifecycleState: "queued",
    dedupe: opts.dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
    deployRunId,
  });
  submission = await queueSubmissionForLock({
    recordsRoot: opts.paths.recordsRoot,
    submissionPath,
    snapshot,
    submission,
  });
  return {
    submission,
    submissionPath,
    executionSnapshotPath,
    lockScope: snapshot.lockScope,
    snapshot,
    deployRunId,
  };
}
