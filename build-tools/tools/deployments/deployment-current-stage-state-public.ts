#!/usr/bin/env zx-wrapper
import type {
  DeploymentCurrentStageState,
  DeploymentDriftStatus,
  DeploymentRetainedArtifactEvidence,
  DeploymentRetainedRenderEvidence,
  DeploymentStageRequiredCheck,
} from "./deployment-current-stage-state-types";
import { secretSafeStageStateValue } from "./deployment-current-stage-state-extras";
import type { DeploymentRollbackCandidate } from "./deployment-rollback-candidates";

const SAFE_HASH = /^sha256:[a-f0-9]{16,}$/i;

function safeOptional(value: unknown): string | undefined {
  const text = String(value || "").trim();
  return text ? secretSafeStageStateValue(text) : undefined;
}

function safeHash(value: unknown): string | undefined {
  const text = String(value || "").trim();
  if (!text) return undefined;
  return SAFE_HASH.test(text) ? text : secretSafeStageStateValue(text);
}

function safeCheck(check: DeploymentStageRequiredCheck): DeploymentStageRequiredCheck {
  return {
    name: secretSafeStageStateValue(check.name),
    ...(safeOptional(check.status) ? { status: safeOptional(check.status) } : {}),
    ...(safeOptional(check.reporterIdentity)
      ? { reporterIdentity: safeOptional(check.reporterIdentity) }
      : {}),
    ...(safeOptional(check.recordRef) ? { recordRef: safeOptional(check.recordRef) } : {}),
  };
}

function safeEvidence(
  evidence: DeploymentRetainedRenderEvidence,
): DeploymentRetainedRenderEvidence {
  return {
    kind: evidence.kind,
    referencePath: secretSafeStageStateValue(evidence.referencePath),
    ...(safeHash(evidence.fingerprint) ? { fingerprint: safeHash(evidence.fingerprint) } : {}),
  };
}

function safeArtifactEvidence(
  evidence: DeploymentRetainedArtifactEvidence,
): DeploymentRetainedArtifactEvidence {
  return {
    identity: secretSafeStageStateValue(evidence.identity),
    ...(safeOptional(evidence.storedArtifactPath)
      ? { storedArtifactPath: safeOptional(evidence.storedArtifactPath) }
      : {}),
    ...(safeOptional(evidence.provenancePath)
      ? { provenancePath: safeOptional(evidence.provenancePath) }
      : {}),
  };
}

function safeDriftStatus(drift: DeploymentDriftStatus): DeploymentDriftStatus {
  return {
    state: drift.state,
    ...(safeOptional(drift.checkedAt) ? { checkedAt: safeOptional(drift.checkedAt) } : {}),
    ...(safeOptional(drift.summary) ? { summary: safeOptional(drift.summary) } : {}),
    ...(safeHash(drift.fingerprint) ? { fingerprint: safeHash(drift.fingerprint) } : {}),
  };
}

export function publicCurrentStageState(state: DeploymentCurrentStageState) {
  const requiredChecks = Array.isArray(state.requiredChecks) ? state.requiredChecks : [];
  const retainedRenderEvidence = Array.isArray(state.retainedRenderEvidence)
    ? state.retainedRenderEvidence
    : [];
  const retainedArtifactEvidence = Array.isArray(state.retainedArtifactEvidence)
    ? state.retainedArtifactEvidence
    : [];
  const driftStatus = state.driftStatus || { state: "unknown" as const };
  return {
    ...state,
    sourceRevision: secretSafeStageStateValue(state.sourceRevision),
    artifactIdentity: secretSafeStageStateValue(state.artifactIdentity),
    approvalContext: state.approvalContext
      ? {
          ...state.approvalContext,
          requiredApprovals: state.approvalContext.requiredApprovals.map(secretSafeStageStateValue),
          ...(safeOptional(state.approvalContext.requestedBy)
            ? { requestedBy: safeOptional(state.approvalContext.requestedBy) }
            : {}),
          ...(safeHash(state.approvalContext.payloadFingerprint)
            ? { payloadFingerprint: safeHash(state.approvalContext.payloadFingerprint) }
            : {}),
        }
      : undefined,
    requiredChecks: requiredChecks.map(safeCheck),
    retainedRenderEvidence: retainedRenderEvidence.map(safeEvidence),
    retainedArtifactEvidence: retainedArtifactEvidence.map(safeArtifactEvidence),
    driftStatus: safeDriftStatus(driftStatus),
  };
}

export function publicRollbackCandidate(candidate: DeploymentRollbackCandidate) {
  return {
    ...candidate,
    sourceRevision: secretSafeStageStateValue(candidate.sourceRevision),
    artifactIdentity: secretSafeStageStateValue(candidate.artifactIdentity),
  };
}
