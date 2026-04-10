#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import {
  requireBuiltInExecutionBoundary,
  requiredApprovalFacts,
} from "./deployment-admission-approvals.ts";
import {
  createDeploymentAdmissionBinding,
  requiredCheckSubjectsFor,
  type DeploymentAdmissionOperationKind,
} from "./deployment-admission-binding.ts";
import {
  defaultRequestedBy,
  type DeploymentAdmissionCheckFact,
  type DeploymentAdmissionEvidence,
  type DeploymentAdmissionPolicyEvaluation,
  type DeploymentPrerequisiteFact,
} from "./deployment-admission-evidence.ts";
import {
  latestSuccessfulDeploymentRecord,
  sourceAdmissionChecks,
  type DeploymentRunRecordLike,
} from "./deployment-admission-records.ts";
import {
  evaluateAttestationPolicy,
  evaluateSbomPolicy,
  evaluateSupplyChainGatePolicies,
} from "./deployment-admission-supply-chain-evaluator.ts";

type AdmittedContextLike = {
  source: {
    sourceRevision: string;
    artifactIdentity?: string;
    sourceRunId?: string;
  };
  targetEnvironment: {
    providerTargetIdentity: string;
  };
  policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
};

function sourceRevisionFor(
  admittedContext: AdmittedContextLike,
  sourceRecord?: DeploymentRunRecordLike,
): string {
  const replayRevision = (sourceRecord as any)?.admittedContext?.source?.sourceRevision;
  return typeof replayRevision === "string" && replayRevision.trim()
    ? replayRevision.trim()
    : admittedContext.source.sourceRevision;
}

function requiredCheckFacts(opts: {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  binding: ReturnType<typeof createDeploymentAdmissionBinding>;
  sourceRecord?: DeploymentRunRecordLike;
  evidence?: DeploymentAdmissionEvidence;
}): DeploymentAdmissionCheckFact[] {
  const subjects = new Set(requiredCheckSubjectsFor(opts.operationKind, opts.binding));
  const current = (opts.evidence?.checks || [])
    .filter((check) => check.status === "passed" && subjects.has(check.subject))
    .map((check) => ({
      name: check.name,
      subject: check.subject,
      checkedAt: check.checkedAt,
      ...(check.recordRef ? { recordRef: check.recordRef } : {}),
    }));
  const carried = sourceAdmissionChecks(opts.sourceRecord).filter((check) =>
    subjects.has(check.subject),
  );
  return opts.deployment.admissionPolicy.requiredChecks.map((name) => {
    const hit =
      current.find((check) => check.name === name) || carried.find((check) => check.name === name);
    if (!hit) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared admission requires check ${name} for subject(s) ${Array.from(subjects).join(", ")}`,
      );
    }
    return hit;
  });
}

async function prerequisiteFacts(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  evidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentPrerequisiteFact[]> {
  const facts: DeploymentPrerequisiteFact[] = [];
  for (const prerequisite of opts.deployment.prerequisites) {
    const hit = await latestSuccessfulDeploymentRecord({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deploymentId: prerequisite.deploymentId,
    });
    if (!hit) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `prerequisite deployment has no successful admitted run: ${prerequisite.deploymentId}`,
      );
    }
    if (prerequisite.mode === "health_gated") {
      if (!hit.record.publicUrl && !hit.record.healthUrl) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `health_gated prerequisite is underspecified: ${prerequisite.deploymentId}`,
        );
      }
      const health = (opts.evidence?.prerequisiteHealth || []).find(
        (entry) => entry.deploymentId === prerequisite.deploymentId && entry.status === "healthy",
      );
      if (!health) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `health_gated prerequisite lacks fresh health evidence: ${prerequisite.deploymentId}`,
        );
      }
      facts.push({
        deploymentId: prerequisite.deploymentId,
        mode: prerequisite.mode,
        sourceRecordPath: hit.recordPath,
        checkedAt: health.checkedAt,
        ...(health.evidenceRef ? { healthEvidenceRef: health.evidenceRef } : {}),
      });
      continue;
    }
    facts.push({
      deploymentId: prerequisite.deploymentId,
      mode: prerequisite.mode,
      sourceRecordPath: hit.recordPath,
    });
  }
  return facts;
}

export async function evaluateDeploymentAdmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  admittedContext: AdmittedContextLike;
  sourceRecord?: DeploymentRunRecordLike;
  artifactLineageId?: string;
  evidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentAdmissionPolicyEvaluation> {
  requireBuiltInExecutionBoundary(opts.deployment);
  const requestedBy = opts.evidence?.requestedBy || defaultRequestedBy();
  const binding = createDeploymentAdmissionBinding({
    deployment: opts.deployment,
    sourceRevision: sourceRevisionFor(opts.admittedContext, opts.sourceRecord),
    sourceRunId:
      opts.admittedContext.source.sourceRunId ||
      (typeof opts.sourceRecord?.deployRunId === "string"
        ? opts.sourceRecord.deployRunId
        : undefined),
    artifactIdentity:
      opts.admittedContext.source.artifactIdentity || opts.sourceRecord?.artifact?.identity,
    artifactLineageId:
      opts.artifactLineageId ||
      opts.sourceRecord?.artifactLineageId ||
      opts.sourceRecord?.artifact?.identity,
    provisionerPlanFingerprint: opts.evidence?.provisionerPlanFingerprint,
    buildInputsFingerprint: opts.evidence?.buildInputsFingerprint,
  });
  const attestation = evaluateAttestationPolicy({
    policy: opts.deployment.admissionPolicy,
    binding,
    admittedContext: opts.admittedContext,
    evidence: opts.evidence?.attestations,
  });
  const sbom = evaluateSbomPolicy({
    policy: opts.deployment.admissionPolicy,
    binding,
    evidence: opts.evidence?.sboms,
  });
  const supplyChainGates = evaluateSupplyChainGatePolicies({
    policy: opts.deployment.admissionPolicy,
    operationKind: opts.operationKind,
    sourceRecord: opts.sourceRecord,
    evidence: opts.evidence?.supplyChainGates,
  });
  return {
    evaluatedAt: new Date().toISOString(),
    requestedBy,
    ...(opts.evidence?.submittedBy ? { submittedBy: opts.evidence.submittedBy } : {}),
    binding,
    requiredChecks: requiredCheckFacts({
      deployment: opts.deployment,
      operationKind: opts.operationKind,
      binding,
      sourceRecord: opts.sourceRecord,
      evidence: opts.evidence,
    }),
    requiredApprovals: requiredApprovalFacts({
      deployment: opts.deployment,
      operationKind: opts.operationKind,
      sourceRecord: opts.sourceRecord,
      evidence: opts.evidence,
      requestedBy: requestedBy.principalId,
      binding,
    }),
    prerequisites: await prerequisiteFacts({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      evidence: opts.evidence,
    }),
    ...(attestation ? { attestation } : {}),
    ...(sbom ? { sbom } : {}),
    supplyChainGates,
  };
}
