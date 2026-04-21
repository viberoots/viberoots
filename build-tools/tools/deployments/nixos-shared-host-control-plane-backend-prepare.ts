#!/usr/bin/env zx-wrapper
import { defaultRequestedBy } from "./deployment-admission-evidence.ts";
import { createAdmissionFailureSubmission } from "./nixos-shared-host-control-plane-admission-failure.ts";
import { evaluateNixosSharedHostControlPlaneAdmission } from "./nixos-shared-host-control-plane-admission.ts";
import { queueBackendSubmissionForLock } from "./nixos-shared-host-control-plane-backend-submit.ts";
import {
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import type {
  NixosSharedHostControlPlaneOperationKind,
  NixosSharedHostControlPlanePaths,
  NixosSharedHostControlPlaneSubmission,
  NixosSharedHostPublishBehavior,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import { ensureNoActiveProgressiveRun } from "./nixos-shared-host-control-plane-progressive-guard.ts";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";
import {
  createNixosSharedHostControlPlaneSnapshot,
  createNixosSharedHostSubmissionId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot.ts";
import {
  executionSnapshotPathFor,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store.ts";
import { writeNixosSharedHostProvisionerPlan } from "./nixos-shared-host-provisioner-plan.ts";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records.ts";

export async function prepareBackendNixosSharedHostControlPlaneRun(opts: {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionId?: string;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: any;
  componentArtifacts?: any[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const submissionId = opts.submissionId || createNixosSharedHostSubmissionId();
  const requestedBy =
    opts.requestedBy || opts.admissionEvidence?.requestedBy || defaultRequestedBy();
  const snapshot = await createNixosSharedHostControlPlaneSnapshot(
    { ...opts, deferSecretReferenceResolution: true },
    submissionId,
  );
  const deployRunId = createNixosSharedHostDeployRunId();
  snapshot.provisionerPlan = await writeNixosSharedHostProvisionerPlan({ snapshot });
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  const refs = {
    submissionPath,
    executionSnapshotPath,
  };
  await writeBackendSnapshotDoc(opts.backend, snapshot, executionSnapshotPath);
  try {
    await ensureNoActiveProgressiveRun(opts.paths.recordsRoot, snapshot.lockScope, submissionId, {
      backend: opts.backend,
    });
    await evaluateNixosSharedHostControlPlaneAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backendDatabaseUrl: opts.backend.databaseUrl,
      deployment: opts.deployment,
      snapshot,
      source: opts.source,
      artifactLineageId: opts.artifactLineageId,
      admissionEvidence: opts.admissionEvidence,
    });
    await writeBackendSnapshotDoc(opts.backend, snapshot, executionSnapshotPath);
  } catch (error) {
    const submission = createAdmissionFailureSubmission({
      error,
      snapshot,
      executionSnapshotPath,
      deployRunId,
      dedupe: opts.dedupe,
      requestedBy,
      authorization: opts.authorization,
    });
    if (!submission) throw error;
    await writeBackendSubmissionDoc(opts.backend, submission, refs);
    throw Object.assign(error, { submission });
  }
  const submission = await queueBackendSubmissionForLock({
    backend: opts.backend,
    snapshot,
    submission: createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
      admission: { decision: "admitted", reason: "shared_nonprod" },
      lifecycleState: "queued",
      dedupe: opts.dedupe,
      requestedBy,
      authorization: opts.authorization,
      ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
      deployRunId,
    }),
    refs,
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
