#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { defaultRequestedBy } from "./deployment-admission-evidence";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract";
import { createCloudflarePagesSubmissionId } from "./cloudflare-pages-control-plane-shared";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import { createCloudflarePagesDeployRunId } from "./cloudflare-pages-records";
import {
  CLOUDFLARE_PAGES_TARGET_TRANSITION_RECORD_SCHEMA,
  type CloudflarePagesTargetTransitionRecord,
  writeTransitionRecord,
} from "./cloudflare-pages-target-transition-records";
import {
  type DeploymentTargetException,
  isTargetExceptionActive,
} from "./deployment-target-exceptions";

export const CLOUDFLARE_PAGES_TARGET_TRANSITION_SNAPSHOT_SCHEMA =
  "cloudflare-pages-target-transition-snapshot@1";

export type CloudflarePagesTargetTransitionOperationKind = "retire_target" | "migrate_target";

export function approvalSatisfied(
  exception: DeploymentTargetException,
  evidence?: DeploymentAdmissionEvidence,
): boolean {
  return (evidence?.approvals || []).some(
    (approval) =>
      approval.status === "approved" &&
      [approval.recordRef, approval.approvalId, approval.name].includes(exception.approvalEvidence),
  );
}

function sameAffectedDeployments(
  left: DeploymentTargetException,
  right: DeploymentTargetException,
): boolean {
  return (
    left.affectedDeploymentIds.slice().sort().join(",") ===
    right.affectedDeploymentIds.slice().sort().join(",")
  );
}

function supersedingException(
  deployment: CloudflarePagesDeployment,
  exception: DeploymentTargetException,
): DeploymentTargetException | undefined {
  const currentTime = new Date();
  return deployment.targetExceptions.find(
    (candidate) =>
      candidate.ref !== exception.ref &&
      isTargetExceptionActive(candidate, currentTime) &&
      candidate.oldProviderTargetIdentity === exception.oldProviderTargetIdentity &&
      candidate.newProviderTargetIdentity === exception.newProviderTargetIdentity &&
      sameAffectedDeployments(candidate, exception) &&
      Date.parse(candidate.effectiveAt) > Date.parse(exception.effectiveAt),
  );
}

export function requireTargetException(
  deployment: CloudflarePagesDeployment,
  targetExceptionRef: string,
): DeploymentTargetException {
  const exception = deployment.targetExceptions.find((entry) => entry.ref === targetExceptionRef);
  if (!exception)
    throw new Error(
      `target exception not found on deployment ${deployment.deploymentId}: ${targetExceptionRef}`,
    );
  if (!exception.affectedDeploymentIds.includes(deployment.deploymentId))
    throw new Error(
      `target exception does not cover deployment ${deployment.deploymentId}: ${targetExceptionRef}`,
    );
  if (!isTargetExceptionActive(exception))
    throw new Error(`target exception is not active: ${targetExceptionRef}`);
  const supersededBy = supersedingException(deployment, exception);
  if (supersededBy) {
    throw new Error(`target exception has been superseded by ${supersededBy.ref}`);
  }
  return exception;
}

export function validateTransitionRequest(opts: {
  deployment: CloudflarePagesDeployment;
  operationKind: CloudflarePagesTargetTransitionOperationKind;
  exception: DeploymentTargetException;
}) {
  const currentTargetIdentity = opts.deployment.providerTarget.providerTargetIdentity;
  if (opts.operationKind === "retire_target") {
    if (opts.exception.oldProviderTargetIdentity !== currentTargetIdentity)
      throw new Error(
        `retire-target requires the deployment to still own ${opts.exception.oldProviderTargetIdentity}, got ${currentTargetIdentity}`,
      );
    return;
  }
  if (!opts.exception.newProviderTargetIdentity)
    throw new Error("migrate-target requires target exception new_provider_target_identity");
  if (opts.exception.newProviderTargetIdentity !== currentTargetIdentity)
    throw new Error(
      `migrate-target expects deployment metadata to point at ${opts.exception.newProviderTargetIdentity}, got ${currentTargetIdentity}`,
    );
}

export async function submitCloudflarePagesTargetTransition(opts: {
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  operationKind: CloudflarePagesTargetTransitionOperationKind;
  targetExceptionRef: string;
  authorization?: DeploymentControlPlaneAuthorization;
  admissionEvidence?: DeploymentAdmissionEvidence;
}) {
  const exception = requireTargetException(opts.deployment, opts.targetExceptionRef);
  validateTransitionRequest({
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    exception,
  });
  if (!approvalSatisfied(exception, opts.admissionEvidence)) {
    throw new DeploymentAdmissionError(
      "approval_required",
      `target transition requires reviewed approval evidence ${exception.approvalEvidence}`,
    );
  }
  const authorization = authorizeControlPlaneSubmit({
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    authorization: opts.authorization,
  });
  const submissionId = createCloudflarePagesSubmissionId();
  const executionSnapshotPath = executionSnapshotPathFor(opts.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.recordsRoot, submissionId);
  const requestedBy =
    opts.authorization?.requestedBy || opts.admissionEvidence?.requestedBy || defaultRequestedBy();
  const workerId = `${submissionId}-worker`;
  await writeControlPlaneJson(executionSnapshotPath, {
    schemaVersion: CLOUDFLARE_PAGES_TARGET_TRANSITION_SNAPSHOT_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    lockScope: exception.sharedLockScope,
    targetException: exception,
    requestedBy,
    authorization,
  });
  await writeControlPlaneJson(submissionPath, {
    submissionId,
    submittedAt: new Date().toISOString(),
    operationKind: opts.operationKind,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    lockScope: exception.sharedLockScope,
    lifecycleState: "waiting_for_lock",
    executionSnapshotPath,
    requestedBy,
    authorization,
  });
  const releaseLock = await acquireControlPlaneLock(opts.recordsRoot, exception.sharedLockScope);
  try {
    const deployRunId = createCloudflarePagesDeployRunId("transition");
    const record: CloudflarePagesTargetTransitionRecord = {
      schemaVersion: CLOUDFLARE_PAGES_TARGET_TRANSITION_RECORD_SCHEMA,
      deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      finalOutcome: "succeeded",
      deploymentId: opts.deployment.deploymentId,
      deploymentLabel: opts.deployment.label,
      provider: "cloudflare-pages",
      providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
      oldProviderTargetIdentity: exception.oldProviderTargetIdentity,
      ...(exception.newProviderTargetIdentity
        ? { newProviderTargetIdentity: exception.newProviderTargetIdentity }
        : {}),
      sharedLockScope: exception.sharedLockScope,
      requestedBy,
      authorization,
      targetException: exception,
      resultingOwnershipState:
        opts.operationKind === "retire_target"
          ? { kind: "retired", ownerDeploymentId: null }
          : {
              kind: "migrated",
              ownerDeploymentId: opts.deployment.deploymentId,
              providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
            },
      controlPlane: {
        submissionId,
        submissionPath,
        executionSnapshotPath,
        lockScope: exception.sharedLockScope,
        fencingToken: releaseLock.fencingToken,
        workerId,
      },
    };
    const recordPath = await writeTransitionRecord(opts.recordsRoot, record);
    await writeControlPlaneJson(submissionPath, {
      submissionId,
      submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      operationKind: opts.operationKind,
      deploymentId: opts.deployment.deploymentId,
      deploymentLabel: opts.deployment.label,
      providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
      lockScope: exception.sharedLockScope,
      lifecycleState: "finished",
      finalOutcome: "succeeded",
      deployRunId,
      resultRecordPath: recordPath,
      executionSnapshotPath,
      requestedBy,
      authorization,
    });
    return {
      submission: {
        submissionId,
        submissionPath,
        executionSnapshotPath,
        lockScope: exception.sharedLockScope,
      },
      record,
      recordPath,
    };
  } finally {
    await releaseLock.release();
  }
}
