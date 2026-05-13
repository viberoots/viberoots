#!/usr/bin/env zx-wrapper

export const DEPLOYMENT_CURRENT_STAGE_STATE_SCHEMA = "deployment-current-stage-state@1";

export type DeploymentStageRequiredCheck = {
  name: string;
  status?: string;
  reporterIdentity?: string;
  recordRef?: string;
};

export type DeploymentRetainedRenderEvidence = {
  kind: "replay_snapshot" | "provider_config" | "provisioner_plan" | "execution_snapshot";
  referencePath: string;
  fingerprint?: string;
};

export type DeploymentRetainedArtifactEvidence = {
  identity: string;
  storedArtifactPath?: string;
  provenancePath?: string;
};

export type DeploymentDriftStatus = {
  state: "not_checked" | "in_sync" | "drifted" | "unknown";
  checkedAt?: string;
  summary?: string;
  fingerprint?: string;
};

export type DeploymentCurrentStageState = {
  schemaVersion: typeof DEPLOYMENT_CURRENT_STAGE_STATE_SCHEMA;
  deploymentId: string;
  deploymentLabel: string;
  environmentStage: string;
  providerTargetIdentity: string;
  currentRunId: string;
  operationKind: string;
  sourceRunId?: string;
  sourceRevision: string;
  artifactIdentity: string;
  artifactReuseMode: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  finalOutcome: string;
  updatedAt: string;
  approvalContext?: {
    payloadFingerprint?: string;
    requiredApprovals: string[];
    requestedBy?: string;
  };
  requiredChecks: DeploymentStageRequiredCheck[];
  retainedRenderEvidence: DeploymentRetainedRenderEvidence[];
  retainedArtifactEvidence: DeploymentRetainedArtifactEvidence[];
  driftStatus: DeploymentDriftStatus;
};
