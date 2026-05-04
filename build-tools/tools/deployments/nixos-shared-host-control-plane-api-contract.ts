#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostDeployment } from "./contract";
import type {
  DeploymentAdmissionEvidence,
  DeploymentPrincipal,
} from "./deployment-admission-evidence";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract";
import type {
  DeploymentArtifactBindingProof,
  DeploymentExpectedArtifactIdentities,
} from "./deployment-artifact-binding";
import type {
  NixosSharedHostControlPlaneOperationKind,
  NixosSharedHostPublishBehavior,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract";
import type { NixosSharedHostControlPlaneSourceSelection } from "./nixos-shared-host-control-plane-snapshot";

export const NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "nixos-shared-host-control-plane-submit-request@1";

export type NixosSharedHostControlPlaneSubmitRequest = DeploymentExpectedArtifactIdentities & {
  schemaVersion: typeof NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: NixosSharedHostDeployment;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  idempotencyKey?: string;
  authSessionId?: string;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorization;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  rollback?: boolean;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  source?: NixosSharedHostControlPlaneSourceSelection;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  artifactBindingProof?: DeploymentArtifactBindingProof;
};
