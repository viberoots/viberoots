#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import type {
  CloudflarePagesPreviewCleanupReason,
  CloudflarePagesPreviewIdentitySelector,
} from "./cloudflare-pages-preview.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";

export const CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA =
  "cloudflare-pages-control-plane-snapshot@2";
export const CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMISSION_SCHEMA =
  "cloudflare-pages-control-plane-submission@1";

export type CloudflarePagesPublishMode = "normal" | "preview";
export type CloudflarePagesPublishBehavior = "deploy" | "publish-only";
export type CloudflarePagesControlPlaneOperationKind = "deploy" | "promotion" | "preview_cleanup";

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
  operationKind: CloudflarePagesControlPlaneOperationKind;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  lockScope: string;
  deployment: CloudflarePagesDeployment;
  admittedContext: CloudflarePagesAdmittedContext;
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
  | { decision: "rejected"; reason: "lock_conflict" };

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
  workerId?: string;
  resultRecordPath?: string;
  finalOutcome?: string;
  admission: CloudflarePagesControlPlaneAdmission;
};

export type CloudflarePagesControlPlaneWorkerAuthority = {
  kind: "control-plane-worker";
  submissionId: string;
  submissionPath: string;
  workerId: string;
  lockScope: string;
  executionSnapshotPath: string;
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
