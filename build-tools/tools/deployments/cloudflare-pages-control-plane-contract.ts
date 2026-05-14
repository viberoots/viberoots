#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import type {
  CloudflarePagesPreviewCleanupReason,
  CloudflarePagesPreviewIdentitySelector,
} from "./cloudflare-pages-preview";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneArtifactStatus,
  DeploymentControlPlaneLifecycleState,
  DeploymentControlPlaneRequestDedupe,
  DeploymentControlPlaneServiceInstance,
  DeploymentControlPlaneSubmitRejectionCode,
  DeploymentControlPlaneTerminationReason,
} from "./deployment-control-plane-contract";
import type { DeploymentPrincipal } from "./deployment-admission-evidence";
import type { DeploymentWorkerVaultRuntimeMetadata } from "./deployment-vault-runtime-worker";

export const CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA =
  "cloudflare-pages-control-plane-snapshot@2";
export const CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA =
  "cloudflare-pages-control-plane-submission@2";

export type CloudflarePagesPublishMode = "normal" | "preview";
export type CloudflarePagesPublishBehavior = "deploy" | "publish-only";
export type CloudflarePagesControlPlaneOperationKind =
  | "deploy"
  | "promotion"
  | "rollback"
  | "preview_cleanup";

export type CloudflarePagesSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

export type CloudflarePagesControlPlanePaths = {
  workspaceRoot: string;
  recordsRoot: string;
};

export type CloudflarePagesControlPlaneSnapshot = {
  schemaVersion: typeof CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA;
  submissionId: string;
  submittedAt: string;
  deployBatchId?: string;
  operationKind: CloudflarePagesControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: CloudflarePagesDeployment;
  admittedContext: CloudflarePagesAdmittedContext;
  vaultRuntime?: DeploymentWorkerVaultRuntimeMetadata;
  infisicalRuntime?: CloudflarePagesDeployment["infisicalRuntime"];
  paths: CloudflarePagesControlPlanePaths;
  action:
    | {
        kind: "deploy";
        publishBehavior: CloudflarePagesPublishBehavior;
        publishMode?: CloudflarePagesPublishMode;
        effectiveRunTarget?: CloudflarePagesDeployment["providerTarget"];
        previewIdentitySelector?: CloudflarePagesPreviewIdentitySelector;
        publishInput: {
          kind: "exact-artifact";
          artifact: AdmittedStaticWebappArtifact;
        };
        parentRunId?: string;
        releaseLineageId?: string;
        artifactLineageId?: string;
        sourceRecordPath?: string;
        sourceReplaySnapshotPath?: string;
      }
    | {
        kind: "preview_cleanup";
        publishMode: "preview";
        effectiveRunTarget: CloudflarePagesDeployment["providerTarget"];
        previewIdentitySelector: CloudflarePagesPreviewIdentitySelector;
        cleanupReason: CloudflarePagesPreviewCleanupReason;
        artifactIdentity: string;
        artifactLineageId?: string;
        providerReleaseId?: string;
        parentRunId?: string;
        releaseLineageId?: string;
        sourceRecordPath?: string;
        sourceReplaySnapshotPath?: string;
      };
  smokeConnectOverride?: CloudflarePagesSmokeConnectOverride;
};

export type CloudflarePagesControlPlaneAdmission =
  | { decision: "admitted"; reason: "shared_nonprod" | "production_facing" }
  | {
      decision: "pending_approval";
      reason: "approval_required" | "approval_no_longer_valid";
    }
  | { decision: "rejected"; reason: DeploymentControlPlaneSubmitRejectionCode };

export type CloudflarePagesControlPlaneSubmission = {
  schemaVersion: typeof CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA;
  submissionId: string;
  submittedAt: string;
  completedAt?: string;
  operationKind: CloudflarePagesControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  executionSnapshotPath: string;
  lifecycleState: DeploymentControlPlaneLifecycleState;
  terminationReason: DeploymentControlPlaneTerminationReason;
  dedupe: DeploymentControlPlaneRequestDedupe;
  workerId?: string;
  deployRunId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  execution?: {
    currentStep?: string;
    mutationStartedAt?: string;
    stepStartedAt?: string;
    timeoutMs?: number;
  };
  requestedBy?: DeploymentPrincipal;
  serviceInstance?: DeploymentControlPlaneServiceInstance;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
  authorizationSnapshot?: DeploymentControlPlaneAuthorization;
  rejectionCode?: DeploymentControlPlaneSubmitRejectionCode;
  rejectionMessage?: string;
  pendingReasonCode?: "approval_required" | "approval_no_longer_valid";
  artifact?: DeploymentControlPlaneArtifactStatus;
  latestAction?: {
    actionId: string;
    action: "cancel" | "resume";
    submittedAt: string;
    dedupe: DeploymentControlPlaneRequestDedupe;
    lifecycleState: DeploymentControlPlaneLifecycleState;
    authorizationSnapshot?: DeploymentControlPlaneAuthorization;
    rejectionCode?: DeploymentControlPlaneSubmitRejectionCode | "not_resumable";
  };
  admission: CloudflarePagesControlPlaneAdmission;
};

export type CloudflarePagesControlPlaneWorkerAuthority = {
  kind: "control-plane-worker";
  submissionId: string;
  workerId: string;
  lockScope: string;
  fencingToken?: string;
  executionSnapshotPath: string;
  submissionPath?: string;
  recordExecutionSnapshotPath?: string;
};

export function requireCloudflarePagesControlPlaneAuthority(
  deployment: CloudflarePagesDeployment,
  authority?: CloudflarePagesControlPlaneWorkerAuthority,
): CloudflarePagesControlPlaneWorkerAuthority {
  if (
    deployment.protectionClass !== "shared_nonprod" &&
    deployment.protectionClass !== "production_facing"
  ) {
    throw new Error(
      `unsupported protection_class "${deployment.protectionClass}" for cloudflare-pages mutation`,
    );
  }
  if (authority?.kind === "control-plane-worker") return authority;
  throw new Error(
    `cloudflare-pages ${deployment.protectionClass} mutation must execute through the shared control plane`,
  );
}
