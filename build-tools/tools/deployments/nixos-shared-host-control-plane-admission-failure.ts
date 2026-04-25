#!/usr/bin/env zx-wrapper
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneServiceInstance,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import { pendingApprovalSummaryFor } from "./deployment-control-plane-approval.ts";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";

export function createAdmissionFailureSubmission(opts: {
  error: unknown;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  executionSnapshotPath: string;
  deployRunId: string;
  dedupe: DeploymentControlPlaneRequestDedupe;
  requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  serviceInstance?: DeploymentControlPlaneServiceInstance;
}) {
  if (!(opts.error instanceof DeploymentAdmissionError)) return undefined;
  const pending =
    opts.error.code === "approval_required" || opts.error.code === "approval_no_longer_valid";
  return createNixosSharedHostControlPlaneSubmission(opts.snapshot, opts.executionSnapshotPath, {
    admission: pending
      ? { decision: "pending_approval", reason: opts.error.code }
      : { decision: "rejected", reason: opts.error.code },
    lifecycleState: pending ? "pending_approval" : "finished",
    dedupe: opts.dedupe,
    ...(pending
      ? {
          deployRunId: opts.deployRunId,
          approval: pendingApprovalSummaryFor({
            snapshot: opts.snapshot,
            approvalNames: opts.snapshot.deployment.admissionPolicy.requiredApprovals,
          }),
        }
      : {}),
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    authorizationSnapshot: opts.authorizationSnapshot,
    ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
    ...(pending ? { pendingReasonCode: opts.error.code } : { rejectionCode: opts.error.code }),
    ...(pending
      ? {}
      : {
          completedAt: new Date().toISOString(),
          terminationReason: "no_longer_admitted" as const,
        }),
  });
}
