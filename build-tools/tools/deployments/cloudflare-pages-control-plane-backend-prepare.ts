#!/usr/bin/env zx-wrapper
import { defaultRequestedBy } from "./deployment-admission-evidence";
import {
  type NixosSharedHostControlPlaneBackendTarget,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "./nixos-shared-host-control-plane-backend";
import { queueBackendSubmissionForLock } from "./nixos-shared-host-control-plane-backend-submit";
import {
  executionSnapshotPathFor,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store";
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract";
import { createCloudflarePagesControlPlaneSubmission } from "./cloudflare-pages-control-plane-submission";
import type { CloudflarePagesControlPlaneSubmitRequest } from "./cloudflare-pages-control-plane-api-contract";
import { type ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit";
import { createCloudflarePagesDeployRunId } from "./cloudflare-pages-records";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneServiceInstance,
} from "./deployment-control-plane-contract";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution";
import {
  buildCloudflarePagesBackendSnapshot,
  type CloudflarePagesBackendSnapshot,
} from "./cloudflare-pages-control-plane-backend-snapshot";
import { reviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";
import { putVerifiedArtifactObject } from "./control-plane-artifact-store";
import { writeBackendSnapshotArtifactObjects } from "./control-plane-artifact-snapshot-metadata";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";

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
  serviceInstance?: DeploymentControlPlaneServiceInstance;
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
            rejectionMessage: redactDeploymentAuthText(opts.error.message),
          }),
      dedupe: opts.dedupe,
      requestedBy: opts.requestedBy,
      ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
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
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  governanceResolver?: DeploymentLaneGovernanceResolver;
  objectStore?: ControlPlaneArtifactStore;
}) {
  const snapshot = await buildCloudflarePagesBackendSnapshot(opts.resolved, {
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    governanceResolver: opts.governanceResolver,
  });
  (snapshot as any).expectedCurrentRunId = (
    await reviewedCurrentStageExpectation({
      backend: opts.backend,
      deployment: opts.request.deployment,
    })
  ).expectedCurrentRunId;
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
      if (opts.objectStore) {
        (snapshot as any).executionSnapshotObject = await putVerifiedArtifactObject({
          store: opts.objectStore,
          body: Buffer.from(JSON.stringify(snapshot) + "\n"),
          payloadKind: "execution-snapshot",
          contentType: "application/json",
          provenance: {
            deploymentId: String((snapshot as any).deploymentId || ""),
            submissionId: opts.request.submissionId,
          },
        });
      }
      await writeBackendSnapshotDoc(opts.backend, snapshot, refs.executionSnapshotPath);
      await writeBackendSnapshotArtifactObjects({
        backend: opts.backend,
        snapshot: snapshot as any,
      });
    } catch (error) {
      if (!(error instanceof DeploymentAdmissionError)) throw error;
      const submission = admissionFailureSubmission({
        request: opts.request,
        snapshot: snapshot as CloudflarePagesControlPlaneSnapshot,
        executionSnapshotPath: refs.executionSnapshotPath,
        dedupe: opts.dedupe,
        requestedBy,
        ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
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
  const deployRunId = deployRunIdFor(snapshot);
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
        ...(opts.serviceInstance ? { serviceInstance: opts.serviceInstance } : {}),
        ...(opts.authorization ? { authorization: opts.authorization } : {}),
        ...(opts.authorizationSnapshot
          ? { authorizationSnapshot: opts.authorizationSnapshot }
          : {}),
        ...(deployRunId ? { deployRunId } : {}),
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
