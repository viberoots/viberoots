#!/usr/bin/env zx-wrapper
import type {
  CloudflarePagesControlPlaneOperationKind,
  CloudflarePagesControlPlaneSnapshot,
  CloudflarePagesPublishBehavior,
  CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract";
import {
  createCloudflarePagesSubmissionId,
  withCloudflarePagesControlPlaneRun,
} from "./cloudflare-pages-control-plane-shared";
import {
  createCloudflarePagesControlPlaneSnapshot,
  type CloudflarePagesPromotionSourceSelection,
} from "./cloudflare-pages-control-plane-snapshot";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records";
import type { CloudflarePagesDeployment } from "./contract";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentRunRecordLike } from "./deployment-admission-records";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneRequestDedupe,
} from "./deployment-control-plane-contract";
import {
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import { type AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";

type SubmitOpts = {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  submissionId?: string;
  dedupe?: DeploymentControlPlaneRequestDedupe;
  requestedBy?: {
    principalId: string;
    displayName?: string;
  };
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  deployBatchId?: string;
  artifactDir?: string;
  artifact?: AdmittedStaticWebappArtifact;
  operationKind?: CloudflarePagesControlPlaneOperationKind;
  publishBehavior?: CloudflarePagesPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source?: CloudflarePagesPromotionSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
  hooks?: {
    afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
    onLockAcquired?: () => Promise<void> | void;
  };
};

function directDedupe(submissionId: string): DeploymentControlPlaneRequestDedupe {
  return {
    mode: "created",
    requestFingerprint: `direct:${submissionId}`,
  };
}

async function runWorker(opts: {
  executionSnapshotPath: string;
  submissionPath: string;
  workerId: string;
}): Promise<{ record: CloudflarePagesDeployRecord; recordPath: string }> {
  const snapshot = await readControlPlaneJson<CloudflarePagesControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  if (snapshot.action.kind !== "deploy") {
    throw new Error(
      `cloudflare-pages control-plane worker does not support action ${snapshot.action.kind}`,
    );
  }
  return await runCloudflarePagesStaticDeploy({
    workspaceRoot: snapshot.paths.workspaceRoot,
    deployment: snapshot.deployment,
    artifact: snapshot.action.publishInput.artifact,
    recordsRoot: snapshot.paths.recordsRoot,
    operationKind: snapshot.operationKind,
    admittedContext: snapshot.admittedContext,
    ...(snapshot.action.parentRunId ? { parentRunId: snapshot.action.parentRunId } : {}),
    ...(snapshot.action.releaseLineageId
      ? { releaseLineageId: snapshot.action.releaseLineageId }
      : {}),
    ...(snapshot.action.artifactLineageId
      ? { artifactLineageId: snapshot.action.artifactLineageId }
      : {}),
    ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
    ...(snapshot.action.publishMode ? { publishMode: snapshot.action.publishMode } : {}),
    ...(snapshot.action.effectiveRunTarget
      ? { effectiveRunTarget: snapshot.action.effectiveRunTarget }
      : {}),
    ...(snapshot.action.previewIdentitySelector
      ? { previewIdentitySelector: snapshot.action.previewIdentitySelector }
      : {}),
    authority: {
      kind: "control-plane-worker",
      submissionId: snapshot.submissionId,
      submissionPath: opts.submissionPath,
      workerId: opts.workerId,
      lockScope: snapshot.lockScope,
      executionSnapshotPath: opts.executionSnapshotPath,
    },
    ...(snapshot.smokeConnectOverride
      ? { smokeConnectOverride: snapshot.smokeConnectOverride }
      : {}),
  });
}

export async function submitCloudflarePagesControlPlaneDeploy(opts: SubmitOpts): Promise<{
  submission: {
    submissionId: string;
    submittedAt: string;
    operationKind: CloudflarePagesControlPlaneSnapshot["operationKind"];
    deploymentId: string;
    deploymentLabel: string;
    providerTargetIdentity: string;
    lockScope: string;
    executionSnapshotPath: string;
    workerId?: string;
    resultRecordPath?: string;
    finalOutcome?: string;
    admission: { decision: "admitted" | "rejected"; reason: string };
    completedAt?: string;
  };
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: CloudflarePagesDeployRecord;
  recordPath: string;
}> {
  const submissionId = opts.submissionId || createCloudflarePagesSubmissionId();
  const dedupe = opts.dedupe || directDedupe(submissionId);
  const snapshot = await createCloudflarePagesControlPlaneSnapshot(opts, submissionId);
  try {
    snapshot.admittedContext = {
      ...snapshot.admittedContext,
      policyEvaluation: await evaluateDeploymentAdmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        deployment: opts.deployment,
        operationKind: snapshot.operationKind,
        admittedContext: snapshot.admittedContext,
        sourceRecord: opts.source?.record,
        artifactLineageId: opts.artifactLineageId,
        evidence: opts.admissionEvidence,
      }),
    };
  } catch (error) {
    if (error instanceof DeploymentAdmissionError) {
      const executionSnapshotPath = executionSnapshotPathFor(opts.recordsRoot, submissionId);
      const submissionPath = submissionPathFor(opts.recordsRoot, submissionId);
      const submission = {
        schemaVersion: "cloudflare-pages-control-plane-submission@2" as const,
        submissionId,
        submittedAt: snapshot.submittedAt,
        operationKind: snapshot.operationKind,
        deploymentId: opts.deployment.deploymentId,
        deploymentLabel: opts.deployment.label,
        providerTargetIdentity: snapshot.providerTargetIdentity,
        lockScope: snapshot.lockScope,
        executionSnapshotPath,
        lifecycleState:
          error.code === "approval_required" || error.code === "approval_no_longer_valid"
            ? ("pending_approval" as const)
            : ("finished" as const),
        terminationReason:
          error.code === "approval_required" || error.code === "approval_no_longer_valid"
            ? null
            : ("no_longer_admitted" as const),
        dedupe,
        ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
        ...(opts.authorization ? { authorization: opts.authorization } : {}),
        ...(error.code === "approval_required" || error.code === "approval_no_longer_valid"
          ? {
              pendingReasonCode: error.code,
              admission: { decision: "pending_approval" as const, reason: error.code },
            }
          : {
              completedAt: new Date().toISOString(),
              rejectionCode: error.code,
              admission: { decision: "rejected" as const, reason: error.code },
            }),
      };
      await writeControlPlaneJson(executionSnapshotPath, snapshot);
      await writeControlPlaneJson(submissionPath, submission);
      throw Object.assign(error, {
        submission,
        submissionPath,
        executionSnapshotPath,
      });
    }
    throw error;
  }
  return await withCloudflarePagesControlPlaneRun(
    opts.deployment,
    opts.recordsRoot,
    snapshot,
    async (authority) =>
      await runWorker({
        executionSnapshotPath: authority.executionSnapshotPath,
        submissionPath: authority.submissionPath,
        workerId: authority.workerId,
      }),
    {
      dedupe,
      requestedBy: opts.requestedBy,
      authorization: opts.authorization,
    },
    opts.hooks,
  );
}
