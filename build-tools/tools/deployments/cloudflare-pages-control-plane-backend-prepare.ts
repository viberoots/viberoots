#!/usr/bin/env zx-wrapper
import { defaultRequestedBy } from "./deployment-admission-evidence.ts";
import {
  type NixosSharedHostControlPlaneBackendTarget,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "./nixos-shared-host-control-plane-backend.ts";
import { queueBackendSubmissionForLock } from "./nixos-shared-host-control-plane-backend-submit.ts";
import {
  executionSnapshotPathFor,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store.ts";
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract.ts";
import { createCloudflarePagesControlPlaneSubmission } from "./cloudflare-pages-control-plane-submission.ts";
import type { CloudflarePagesControlPlaneSubmitRequest } from "./cloudflare-pages-control-plane-api-contract.ts";
import { type ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit.ts";
import { createCloudflarePagesDeployRunId } from "./cloudflare-pages-records.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
} from "./deployment-control-plane-contract.ts";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution.ts";
import {
  buildCloudflarePagesBackendSnapshot,
  type CloudflarePagesBackendSnapshot,
} from "./cloudflare-pages-control-plane-backend-snapshot.ts";

type RequestDedupe = {
  mode: "created" | "reused";
  requestFingerprint: string;
  idempotencyKey?: string;
};

function submissionRefs(recordsRoot: string, submissionId: string) {
  return {
    executionSnapshotPath: executionSnapshotPathFor(recordsRoot, submissionId),
    submissionPath: submissionPathFor(recordsRoot, submissionId),
  };
}

function requestedByFor(request: CloudflarePagesControlPlaneSubmitRequest) {
  return request.requestedBy || request.admissionEvidence?.requestedBy || defaultRequestedBy();
}

function deployRunIdFor(snapshot: CloudflarePagesBackendSnapshot): string | undefined {
  return "admittedContext" in snapshot ? createCloudflarePagesDeployRunId() : undefined;
}

function admissionFailureSubmission(opts: {
  request: CloudflarePagesControlPlaneSubmitRequest;
  snapshot: CloudflarePagesControlPlaneSnapshot;
  executionSnapshotPath: string;
  dedupe: RequestDedupe;
  requestedBy: ReturnType<typeof requestedByFor>;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  error: DeploymentAdmissionError;
}) {
  const pendingApproval =
    opts.error.code === "approval_required" || opts.error.code === "approval_no_longer_valid";
  return createCloudflarePagesControlPlaneSubmission(
    opts.request.deployment,
    opts.snapshot,
    opts.executionSnapshotPath,
    {
      admission: pendingApproval
        ? { decision: "pending_approval", reason: opts.error.code }
        : { decision: "rejected", reason: opts.error.code },
      lifecycleState: pendingApproval ? "pending_approval" : "finished",
      ...(pendingApproval
        ? { pendingReasonCode: opts.error.code }
        : {
            completedAt: new Date().toISOString(),
            terminationReason: "no_longer_admitted" as const,
            rejectionCode: opts.error.code,
          }),
      dedupe: opts.dedupe,
      requestedBy: opts.requestedBy,
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
      ...(opts.authorizationSnapshot ? { authorizationSnapshot: opts.authorizationSnapshot } : {}),
      deployRunId: createCloudflarePagesDeployRunId(),
    },
  );
}

async function backfillMissingAdmission(opts: {
  request: CloudflarePagesControlPlaneSubmitRequest;
  snapshot: CloudflarePagesControlPlaneSnapshot;
  workspaceRoot: string;
  recordsRoot: string;
  governanceResolver?: DeploymentLaneGovernanceResolver;
}) {
  if (!opts.snapshot.admittedContext || opts.snapshot.admittedContext.policyEvaluation) {
    return opts.snapshot;
  }
  opts.snapshot.admittedContext = {
    ...opts.snapshot.admittedContext,
    policyEvaluation: await evaluateDeploymentAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.request.deployment,
      operationKind: opts.snapshot.operationKind as any,
      admittedContext: opts.snapshot.admittedContext,
      evidence: opts.request.admissionEvidence,
      governanceResolver: opts.governanceResolver,
    }),
  };
  return opts.snapshot;
}

export async function prepareBackendCloudflarePagesControlPlaneRun(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: CloudflarePagesControlPlaneSubmitRequest;
  resolved: ResolvedCloudflarePagesServiceSubmitRequest;
  dedupe: RequestDedupe;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  governanceResolver?: DeploymentLaneGovernanceResolver;
}) {
  const snapshot = await buildCloudflarePagesBackendSnapshot(opts.resolved, {
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    governanceResolver: opts.governanceResolver,
  });
  const refs = submissionRefs(opts.recordsRoot, opts.request.submissionId);
  const requestedBy = requestedByFor(opts.request);
  await writeBackendSnapshotDoc(opts.backend, snapshot, refs.executionSnapshotPath);
  if ("admittedContext" in snapshot && snapshot.admittedContext) {
    try {
      await backfillMissingAdmission({
        request: opts.request,
        snapshot: snapshot as CloudflarePagesControlPlaneSnapshot,
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        governanceResolver: opts.governanceResolver,
      });
      await writeBackendSnapshotDoc(opts.backend, snapshot, refs.executionSnapshotPath);
    } catch (error) {
      if (!(error instanceof DeploymentAdmissionError)) throw error;
      const submission = admissionFailureSubmission({
        request: opts.request,
        snapshot: snapshot as CloudflarePagesControlPlaneSnapshot,
        executionSnapshotPath: refs.executionSnapshotPath,
        dedupe: opts.dedupe,
        requestedBy,
        ...(opts.authorization ? { authorization: opts.authorization } : {}),
        ...(opts.authorizationSnapshot
          ? { authorizationSnapshot: opts.authorizationSnapshot }
          : {}),
        error,
      });
      await writeBackendSubmissionDoc(opts.backend, submission, refs);
      throw Object.assign(error, { submission });
    }
  }
  const submission = await queueBackendSubmissionForLock({
    backend: opts.backend,
    snapshot: snapshot as any,
    submission: createCloudflarePagesControlPlaneSubmission(
      opts.request.deployment,
      snapshot as CloudflarePagesControlPlaneSnapshot,
      refs.executionSnapshotPath,
      {
        admission: {
          decision: "admitted",
          reason:
            opts.request.deployment.protectionClass === "production_facing"
              ? "production_facing"
              : "shared_nonprod",
        },
        lifecycleState: "queued",
        dedupe: opts.dedupe,
        requestedBy,
        ...(opts.authorization ? { authorization: opts.authorization } : {}),
        ...(opts.authorizationSnapshot
          ? { authorizationSnapshot: opts.authorizationSnapshot }
          : {}),
        ...(deployRunIdFor(snapshot) ? { deployRunId: deployRunIdFor(snapshot) } : {}),
      },
    ),
    refs,
  });
  return {
    submission,
    submissionPath: refs.submissionPath,
    executionSnapshotPath: refs.executionSnapshotPath,
    snapshot,
  };
}
