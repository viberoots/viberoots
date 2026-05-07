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
