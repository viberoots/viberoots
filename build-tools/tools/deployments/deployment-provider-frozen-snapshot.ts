#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding";
import type {
  DeploymentAdmissionEvidence,
  DeploymentAdmissionPolicyEvaluation,
} from "./deployment-admission-evidence";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { AdmittedContextLike } from "./deployment-admitted-context";
import {
  enqueueBackendSubmission,
  readBackendSubmissionBySubmissionId,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  executionSnapshotPathFor,
  submissionPathFor,
} from "./nixos-shared-host-control-plane-store";
import { submitResponseFromSubmission } from "./deployment-control-plane-status";
import {
  assertFrozenReplayAdmissionMatchesSnapshot,
  assertReplayAdmissionMatchesRecord,
} from "./deployment-replay-admission";
import { resolveProviderSubmitIdempotency } from "./deployment-provider-submit-idempotency";
import type { ReviewedCurrentStageExpectation } from "./deployment-current-stage-state-expected";

export const DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA =
  "deployment-provider-frozen-execution-snapshot@1";

export type FrozenProviderAdmission = {
  decision: "admitted";
  reason: "production_facing" | "shared_nonprod";
  policyEvaluation: DeploymentAdmissionPolicyEvaluation;
};

export type FrozenProviderSnapshotFields = ReviewedCurrentStageExpectation & {
  frozenExecutionSchemaVersion: typeof DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA;
  admittedContext: AdmittedContextLike & {
    policyEvaluation: DeploymentAdmissionPolicyEvaluation;
  };
  admission: FrozenProviderAdmission;
};

export function requireFrozenProviderSnapshot(snapshot: Record<string, any>, provider: string) {
  if (snapshot.frozenExecutionSchemaVersion !== DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA) {
    throw new Error(`${provider} worker requires frozen shared-admission snapshot`);
  }
  if (snapshot.admission?.decision !== "admitted" || !snapshot.admission.policyEvaluation) {
    throw new Error(`${provider} worker requires shared admission policy evaluation`);
  }
  if (!snapshot.admittedContext?.policyEvaluation) {
    throw new Error(`${provider} worker requires admittedContext.policyEvaluation`);
  }
  const admissionFingerprint = snapshot.admission.policyEvaluation.binding?.payloadFingerprint;
  const contextFingerprint = snapshot.admittedContext.policyEvaluation.binding?.payloadFingerprint;
  if (!admissionFingerprint || admissionFingerprint !== contextFingerprint) {
    throw new Error(`${provider} worker rejects mismatched shared admission evidence`);
  }
}

export function requireFrozenProviderSubmissionAdmission(opts: {
  provider: string;
  submission: Record<string, any>;
  snapshot: Record<string, any>;
}) {
  const submissionAdmission = opts.submission.admission;
  if (submissionAdmission?.decision !== "admitted" || !submissionAdmission.policyEvaluation) {
    throw new Error(`${opts.provider} worker requires shared submission admission evidence`);
  }
  const submissionFingerprint = submissionAdmission.policyEvaluation.binding?.payloadFingerprint;
  const snapshotFingerprint =
    opts.snapshot.admission?.policyEvaluation?.binding?.payloadFingerprint;
  if (!submissionFingerprint || submissionFingerprint !== snapshotFingerprint) {
    throw new Error(`${opts.provider} worker rejects mismatched submission admission evidence`);
  }
  if (
    JSON.stringify(submissionAdmission.policyEvaluation) !==
    JSON.stringify(opts.snapshot.admission.policyEvaluation)
  ) {
    throw new Error(`${opts.provider} worker rejects stale submission admission policy`);
  }
  if (submissionAdmission.reason !== opts.snapshot.admission?.reason) {
    throw new Error(`${opts.provider} worker rejects stale submission admission envelope`);
  }
}

export function requireFrozenProviderReplaySource(snapshot: Record<string, any>, provider: string) {
  if (!snapshot.sourceRecord || !snapshot.replaySnapshot) {
    throw new Error(`${provider} worker requires frozen replay snapshot`);
  }
  if (!snapshot.parentRunId || !snapshot.releaseLineageId || !snapshot.artifactLineageId) {
    throw new Error(`${provider} worker requires frozen replay lineage`);
  }
  assertReplayAdmissionMatchesRecord({
    provider,
    record: snapshot.sourceRecord,
    replaySnapshot: snapshot.replaySnapshot,
  });
  assertFrozenReplayAdmissionMatchesSnapshot({ provider, snapshot });
  const frozenSource = snapshot.admittedContext?.source || {};
  const replaySource = snapshot.replaySnapshot.admittedContext?.source || {};
  if (
    frozenSource.sourceRunId &&
    frozenSource.sourceRunId !== snapshot.replaySnapshot.deployRunId
  ) {
    throw new Error(`${provider} worker rejects replay source run mismatch`);
  }
  if (
    frozenSource.sourceRevision &&
    replaySource.sourceRevision &&
    frozenSource.sourceRevision !== replaySource.sourceRevision
  ) {
    throw new Error(`${provider} worker rejects replay source revision mismatch`);
  }
  return { record: snapshot.sourceRecord, replaySnapshot: snapshot.replaySnapshot };
}

export async function admitProviderControlPlaneSnapshot(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  admittedContext: AdmittedContextLike;
  evidence?: DeploymentAdmissionEvidence;
  sourceRecord?: any;
  artifactLineageId?: string;
  expectedCurrentRunId?: string | null;
}): Promise<FrozenProviderSnapshotFields> {
  const policyEvaluation = await evaluateDeploymentAdmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    admittedContext: opts.admittedContext,
    ...(opts.sourceRecord ? { sourceRecord: opts.sourceRecord } : {}),
    ...(opts.artifactLineageId ? { artifactLineageId: opts.artifactLineageId } : {}),
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  });
  return {
    frozenExecutionSchemaVersion: DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA,
    expectedCurrentRunId: opts.expectedCurrentRunId ?? null,
    admittedContext: { ...opts.admittedContext, policyEvaluation },
    admission: {
      decision: "admitted",
      reason:
        opts.deployment.protectionClass === "production_facing"
          ? "production_facing"
          : "shared_nonprod",
      policyEvaluation,
    },
  };
}

export async function queueFrozenProviderSubmission(opts: {
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  snapshot: {
    submissionId: string;
    submittedAt: string;
    operationKind: string;
    deploymentId: string;
    deploymentLabel: string;
    providerTargetIdentity: string;
    lockScope: string;
    admission: FrozenProviderAdmission;
  };
}) {
  const dedupe = await resolveProviderSubmitIdempotency({
    backend: opts.backend,
    snapshot: opts.snapshot,
  });
  if (dedupe.mode === "duplicate") {
    const existing = await readBackendSubmissionBySubmissionId(opts.backend, dedupe.targetId);
    if (!existing) throw new Error(`idempotent provider submission missing: ${dedupe.targetId}`);
    return submitResponseFromSubmission({
      ...(existing as any),
      dedupe: {
        ...((existing as any).dedupe || {}),
        mode: "duplicate",
        requestFingerprint: dedupe.requestFingerprint,
        idempotencyKey: dedupe.idempotencyKey,
      },
    });
  }
  const refs = {
    executionSnapshotPath: executionSnapshotPathFor(opts.recordsRoot, opts.snapshot.submissionId),
    submissionPath: submissionPathFor(opts.recordsRoot, opts.snapshot.submissionId),
  };
  await writeBackendSnapshotDoc(opts.backend, opts.snapshot as any, refs.executionSnapshotPath);
  const submission = {
    schemaVersion: "deployment-provider-control-plane-submission@1",
    submissionId: opts.snapshot.submissionId,
    submittedAt: opts.snapshot.submittedAt,
    operationKind: opts.snapshot.operationKind,
    deploymentId: opts.snapshot.deploymentId,
    deploymentLabel: opts.snapshot.deploymentLabel,
    providerTargetIdentity: opts.snapshot.providerTargetIdentity,
    lockScope: opts.snapshot.lockScope,
    executionSnapshotPath: refs.executionSnapshotPath,
    lifecycleState: "queued",
    terminationReason: null,
    dedupe: {
      mode: dedupe.mode,
      requestFingerprint: dedupe.requestFingerprint,
      idempotencyKey: dedupe.idempotencyKey,
    },
    admission: opts.snapshot.admission,
  };
  await writeBackendSubmissionDoc(opts.backend, submission as any, refs);
  await enqueueBackendSubmission(
    opts.backend,
    opts.snapshot.submissionId,
    opts.snapshot.submittedAt,
  );
  return submitResponseFromSubmission(submission as any);
}
