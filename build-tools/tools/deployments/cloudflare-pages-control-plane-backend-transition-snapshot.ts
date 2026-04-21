#!/usr/bin/env zx-wrapper
import type { ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import {
  approvalSatisfied,
  CLOUDFLARE_PAGES_TARGET_TRANSITION_SNAPSHOT_SCHEMA,
} from "./cloudflare-pages-target-transition.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";

export function targetTransitionSnapshot(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "target_transition" }>,
) {
  if (!approvalSatisfied(resolved.targetException, resolved.request.admissionEvidence)) {
    throw new DeploymentAdmissionError(
      "approval_required",
      `target transition requires reviewed approval evidence ${resolved.targetException.approvalEvidence}`,
    );
  }
  return {
    schemaVersion: CLOUDFLARE_PAGES_TARGET_TRANSITION_SNAPSHOT_SCHEMA,
    submissionId: resolved.request.submissionId,
    submittedAt: resolved.request.submittedAt,
    operationKind: resolved.operationKind,
    deploymentId: resolved.request.deployment.deploymentId,
    deploymentLabel: resolved.request.deployment.label,
    providerTargetIdentity: resolved.request.deployment.providerTarget.providerTargetIdentity,
    lockScope: resolved.targetException.sharedLockScope,
    deployment: resolved.request.deployment,
    targetException: resolved.targetException,
  };
}
