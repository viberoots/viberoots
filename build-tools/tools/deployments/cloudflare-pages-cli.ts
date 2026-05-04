#!/usr/bin/env zx-wrapper
import { submitCloudflarePagesControlPlaneDeploy } from "./cloudflare-pages-control-plane";
import {
  submitCloudflarePagesPreviewCleanup,
  submitCloudflarePagesPreviewDeploy,
} from "./cloudflare-pages-preview-control-plane";
import { normalizeCloudflarePagesPreviewCleanupReason } from "./cloudflare-pages-preview";
import {
  resolveCloudflarePagesPromotionSelection,
  submitCloudflarePagesRebuildPerStagePromotion,
} from "./cloudflare-pages-promotion";
import { submitCloudflarePagesRollback } from "./cloudflare-pages-rollback";
import type { CloudflarePagesDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";

export async function runCloudflarePagesCli(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactDirFlag: string;
  resolvedArtifactDir?: string;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  publishOnly: boolean;
  rollback: boolean;
  preview: boolean;
  previewCleanup: boolean;
  sourceRunId: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
  cleanupReason: string;
  provisionOnly: boolean;
}) {
  if (opts.provisionOnly) {
    throw new Error(
      "cloudflare-pages does not support --provision-only on the repo-level deploy front door",
    );
  }
  if (opts.publishOnly) {
    if (!opts.sourceRunId) {
      throw new Error(
        opts.rollback
          ? "cloudflare-pages rollback requires --source-run-id"
          : "cloudflare-pages --publish-only requires --source-run-id to select a promotion source run",
      );
    }
    if (opts.artifactDirFlag) {
      throw new Error(
        opts.rollback
          ? "cloudflare-pages --publish-only --rollback must not use --artifact-dir; replay the admitted exact artifact with --source-run-id"
          : "cloudflare-pages --publish-only must not use --artifact-dir; promote the admitted exact artifact with --source-run-id",
      );
    }
    if (opts.rollback) {
      return await submitCloudflarePagesRollback({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        recordsRoot: opts.recordsRoot,
        sourceRunId: opts.sourceRunId,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      });
    }
    const promotion = await resolveCloudflarePagesPromotionSelection({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId: opts.sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    return await submitCloudflarePagesControlPlaneDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      operationKind: promotion.operationKind,
      artifact: promotion.artifact,
      publishBehavior: "publish-only",
      parentRunId: promotion.parentRunId,
      releaseLineageId: promotion.releaseLineageId,
      artifactLineageId: promotion.artifactLineageId,
      source: {
        record: promotion.sourceRecord,
        recordPath: promotion.sourceRecordPath,
        replaySnapshotPath: promotion.sourceReplaySnapshotPath,
      },
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  if (opts.previewCleanup) {
    if (!opts.sourceRunId) {
      throw new Error(
        "cloudflare-pages --preview-cleanup requires --source-run-id to identify the preview slot",
      );
    }
    return await submitCloudflarePagesPreviewCleanup({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId: opts.sourceRunId,
      cleanupReason: normalizeCloudflarePagesPreviewCleanupReason(opts.cleanupReason),
    });
  }
  if (opts.preview) {
    if (!opts.sourceRunId) {
      throw new Error(
        "cloudflare-pages --preview requires --source-run-id for protected/shared preview publication",
      );
    }
    if (opts.artifactDirFlag) {
      throw new Error(
        "cloudflare-pages --preview must not use --artifact-dir; preview the admitted exact artifact selected by --source-run-id",
      );
    }
    return await submitCloudflarePagesPreviewDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      sourceRunId: opts.sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  if (opts.sourceRunId) {
    return await submitCloudflarePagesRebuildPerStagePromotion({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactDir:
        opts.resolvedArtifactDir ??
        (() => {
          throw new Error(
            "cloudflare-pages rebuild-per-stage promotion requires a resolved artifact directory",
          );
        })(),
      recordsRoot: opts.recordsRoot,
      sourceRunId: opts.sourceRunId,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    });
  }
  return await submitCloudflarePagesControlPlaneDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    artifactDir:
      opts.resolvedArtifactDir ??
      (() => {
        throw new Error("cloudflare-pages normal deploy requires a resolved artifact directory");
      })(),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}
