#!/usr/bin/env zx-wrapper
export const DEPLOYMENT_RESOURCE_KINDS = [
  "Deployment",
  "DeploymentFamily",
  "Component",
  "ProviderTarget",
  "DeploymentContext",
  "ControlPlaneProfile",
  "ControlPlaneSelection",
  "EnvironmentStage",
  "LanePolicy",
  "LaneGovernancePolicy",
  "AdmissionPolicy",
  "RolloutPolicy",
  "PreviewPolicy",
  "SmokePolicy",
  "SourceRefPolicy",
  "ReadinessGatePolicy",
  "AttestationPolicy",
  "SbomPolicy",
  "SupplyChainPolicy",
  "SecretRequirement",
  "RuntimeConfigRequirement",
  "RuntimeInput",
  "AuthProviderProfile",
  "ServiceClientProfile",
  "WorkspaceGraphState",
  "LocalProjectConfigOverride",
  "DeploymentTargetException",
  "Provisioner",
  "ReleaseAction",
  "ArtifactInput",
  "ArtifactChallenge",
  "StaticWebappUploadSession",
  "StagedArtifact",
  "ArtifactBindingProvenance",
  "CleanupEvidence",
  "ExecutionSnapshot",
  "DeployRun",
  "RunAction",
  "CurrentStageState",
  "StageHistoryEntry",
  "AuditEvent",
  "RetainedEvidence",
  "ControlPlaneRuntime",
  "ControlPlaneReadinessEvidence",
  "ControlPlaneObservabilityEvidence",
  "MiniMigrationPreflightEvidence",
] as const;

export type DeploymentResourceKind = (typeof DEPLOYMENT_RESOURCE_KINDS)[number];
export type ResourceAuthority = "reviewed_intent" | "resolved_input" | "observed_runtime";
export type ResourceSourceClass = "buck" | "deployment_context" | "workspace_state" | "runtime";

export type DeploymentResourceTaxonomyEntry = {
  kind: DeploymentResourceKind;
  authority: ResourceAuthority;
  sourceClass: ResourceSourceClass;
};

const OBSERVED_RUNTIME_KINDS = new Set<DeploymentResourceKind>([
  "RuntimeInput",
  "AuthProviderProfile",
  "ArtifactChallenge",
  "StaticWebappUploadSession",
  "StagedArtifact",
  "ArtifactBindingProvenance",
  "CleanupEvidence",
  "ExecutionSnapshot",
  "DeployRun",
  "RunAction",
  "CurrentStageState",
  "StageHistoryEntry",
  "AuditEvent",
  "RetainedEvidence",
  "ControlPlaneRuntime",
  "ControlPlaneReadinessEvidence",
  "ControlPlaneObservabilityEvidence",
  "MiniMigrationPreflightEvidence",
]);

const RESOLVED_INPUT_KINDS = new Set<DeploymentResourceKind>([
  "DeploymentContext",
  "ControlPlaneProfile",
  "ControlPlaneSelection",
  "ServiceClientProfile",
  "WorkspaceGraphState",
  "LocalProjectConfigOverride",
]);

export const DEPLOYMENT_RESOURCE_TAXONOMY: DeploymentResourceTaxonomyEntry[] =
  DEPLOYMENT_RESOURCE_KINDS.map((kind) => ({
    kind,
    authority: OBSERVED_RUNTIME_KINDS.has(kind)
      ? "observed_runtime"
      : RESOLVED_INPUT_KINDS.has(kind)
        ? "resolved_input"
        : "reviewed_intent",
    sourceClass: OBSERVED_RUNTIME_KINDS.has(kind)
      ? "runtime"
      : kind === "WorkspaceGraphState" || kind === "LocalProjectConfigOverride"
        ? "workspace_state"
        : RESOLVED_INPUT_KINDS.has(kind)
          ? "deployment_context"
          : "buck",
  }));

export const DEPLOYMENT_RESOURCE_KIND_SET = new Set<DeploymentResourceKind>(
  DEPLOYMENT_RESOURCE_KINDS,
);
