#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract";
import type { DeploymentServiceClientSelectionEvidence } from "./deployment-service-client-selection";
import type {
  CloudflarePagesPublishBehavior,
  CloudflarePagesPublishMode,
  CloudflarePagesSmokeConnectOverride,
} from "./cloudflare-pages-control-plane-contract";
import type { CloudflarePagesPreviewCleanupReason } from "./cloudflare-pages-preview";
import type { CloudflarePagesTargetTransitionOperationKind } from "./cloudflare-pages-target-transition";
import type { CloudflarePagesArtifactInput } from "./cloudflare-pages-artifact-input";

export const CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA =
  "cloudflare-pages-control-plane-submit-request@1";

export type CloudflarePagesServiceOperationKind =
  | "deploy"
  | "promotion"
  | "rollback"
  | "preview_cleanup"
  | CloudflarePagesTargetTransitionOperationKind;

export type CloudflarePagesControlPlaneSubmitRequest = {
  schemaVersion: typeof CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployment: CloudflarePagesDeployment;
  operationKind: CloudflarePagesServiceOperationKind;
  idempotencyKey?: string;
  requestedBy?: DeploymentAdmissionEvidence["requestedBy"];
  authorization?: DeploymentControlPlaneAuthorization;
  deployBatchId?: string;
  artifactDir?: string;
  artifactInput?: CloudflarePagesArtifactInput;
  expectedSourceRevision?: string;
  sourceRunId?: string;
  targetExceptionRef?: string;
  publishBehavior?: CloudflarePagesPublishBehavior;
  publishMode?: CloudflarePagesPublishMode;
  cleanupReason?: CloudflarePagesPreviewCleanupReason;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
  controlPlaneSelection?: DeploymentServiceClientSelectionEvidence;
};
