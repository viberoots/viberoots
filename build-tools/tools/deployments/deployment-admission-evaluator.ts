#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  requireBuiltInExecutionBoundary,
  requiredApprovalFacts,
} from "./deployment-admission-approvals";
import {
  createDeploymentAdmissionBinding,
  type DeploymentAdmissionOperationKind,
} from "./deployment-admission-binding";
import {
  defaultRequestedBy,
  type DeploymentAdmissionEvidence,
  type DeploymentAdmissionPolicyEvaluation,
} from "./deployment-admission-evidence";
import { type DeploymentRunRecordLike } from "./deployment-admission-records";
import {
  prerequisiteFacts,
  requiredCheckFacts,
  sourceRevisionFor,
  type AdmittedContextLike,
} from "./deployment-admission-facts";
import {
  resolveLaneGovernanceFact,
  type DeploymentLaneGovernanceResolver,
} from "./deployment-lane-governance-resolution";
import {
  evaluateAttestationPolicy,
  evaluateSbomPolicy,
  evaluateSupplyChainGatePolicies,
} from "./deployment-admission-supply-chain-evaluator";
import { evaluateReadinessGatePolicies } from "./deployment-readiness-gates";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import { validatePhase0CurrentAdmission } from "./deployment-phase0-admission";

export async function evaluateDeploymentAdmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  backendDatabaseUrl?: string;
  prerequisiteProvidersByDeploymentId?: Record<string, string>;
  operationKind: DeploymentAdmissionOperationKind;
  admittedContext: AdmittedContextLike;
  sourceRecord?: DeploymentRunRecordLike;
  artifactLineageId?: string;
  evidence?: DeploymentAdmissionEvidence;
  governanceResolver?: DeploymentLaneGovernanceResolver;
}): Promise<DeploymentAdmissionPolicyEvaluation> {
  requireBuiltInExecutionBoundary(opts.deployment);
  const admittedContext = opts.admittedContext;
  if (opts.evidence?.phase0CompatibilityException) {
    admittedContext.phase0CompatibilityException = opts.evidence.phase0CompatibilityException;
  }
  const phase0CurrentErrors = validatePhase0CurrentAdmission({
    deployment: opts.deployment,
    admittedContext,
  });
  if (phase0CurrentErrors.length > 0) {
    throw new DeploymentAdmissionError("no_longer_admitted", phase0CurrentErrors.join("\n"));
  }
  const requestedBy = opts.evidence?.requestedBy || defaultRequestedBy();
  const binding = createDeploymentAdmissionBinding({
    deployment: opts.deployment,
    sourceRevision: sourceRevisionFor(admittedContext, opts.sourceRecord),
    sourceRunId:
      admittedContext.source.sourceRunId ||
      (typeof opts.sourceRecord?.deployRunId === "string"
        ? opts.sourceRecord.deployRunId
        : undefined),
    artifactIdentity:
      admittedContext.source.artifactIdentity || opts.sourceRecord?.artifact?.identity,
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
    admittedContext,
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
  const readinessGates = evaluateReadinessGatePolicies({
    deployment: opts.deployment,
    operationKind: opts.operationKind,
    binding,
    accessMode: opts.evidence?.accessMode,
    evidence: opts.evidence?.readinessGates,
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
      admittedContext,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      prerequisiteProvidersByDeploymentId: opts.prerequisiteProvidersByDeploymentId,
      evidence: opts.evidence,
    }),
    laneGovernance: await resolveLaneGovernanceFact({
      deployment: opts.deployment,
      evidence: opts.evidence?.laneGovernance,
      resolver: opts.governanceResolver,
    }),
    ...(attestation ? { attestation } : {}),
    ...(sbom ? { sbom } : {}),
    supplyChainGates,
    readinessGates,
  };
}
