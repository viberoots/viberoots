#!/usr/bin/env zx-wrapper
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission.ts";
import { cleanupCloudflarePagesPreview } from "./cloudflare-pages-preview-cleanup.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
  type CloudflarePagesControlPlaneSnapshot,
} from "./cloudflare-pages-control-plane-contract.ts";
import {
  createCloudflarePagesSubmissionId,
  withCloudflarePagesControlPlaneRun,
} from "./cloudflare-pages-control-plane-shared.ts";
import {
  deriveCloudflarePagesPreviewTarget,
  cloudflarePagesPreviewIdentitySelector,
  type CloudflarePagesPreviewCleanupReason,
} from "./cloudflare-pages-preview.ts";
import {
  findLatestCloudflarePagesPreviewRecord,
  resolveCloudflarePagesPreviewSelection,
} from "./cloudflare-pages-preview-source.ts";
import {
  createCloudflarePagesDeployRecord,
  createCloudflarePagesDeployRunId,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint.ts";

function previewCleanupRecord(opts: {
  deployment: CloudflarePagesDeployment;
  authority: {
    kind: "control-plane-worker";
    submissionId: string;
    submissionPath: string;
    workerId: string;
    lockScope: string;
    executionSnapshotPath: string;
  };
  admittedContext: CloudflarePagesAdmittedContext;
  artifactIdentity: string;
  artifactLineageId: string;
  parentRunId?: string;
  releaseLineageId?: string;
  effectiveRunTarget: ReturnType<typeof deriveCloudflarePagesPreviewTarget>;
  sourceRunId: string;
  cleanupReason: CloudflarePagesPreviewCleanupReason;
  finalOutcome: "succeeded" | "publish_failed";
  error?: string;
}) {
  return createCloudflarePagesDeployRecord(opts.deployment, {
    deployRunId: createCloudflarePagesDeployRunId("preview-cleanup"),
    operationKind: "preview_cleanup",
    runClassification: "preview_cleanup",
    publishMode: "preview",
    finalOutcome: opts.finalOutcome,
    artifactIdentity: opts.artifactIdentity,
    artifactLineageId: opts.artifactLineageId,
    admittedContext: opts.admittedContext,
    authority: opts.authority,
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
    ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
    effectiveRunTarget: opts.effectiveRunTarget,
    previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(opts.sourceRunId),
    cleanupReason: opts.cleanupReason,
    deploymentMetadataFingerprint: deploymentMetadataFingerprintFor(opts.deployment),
    ...(opts.finalOutcome === "publish_failed" ? { failedStep: "preview_cleanup" as const } : {}),
    ...(opts.error ? { error: opts.error } : {}),
  });
}

export async function submitCloudflarePagesPreviewCleanup(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
  cleanupReason: CloudflarePagesPreviewCleanupReason;
}) {
  const effectiveRunTarget = deriveCloudflarePagesPreviewTarget(opts.deployment, opts.sourceRunId);
  const source = await resolveCloudflarePagesPreviewSelection({
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    sourceRunId: opts.sourceRunId,
  });
  const latestPreview = await findLatestCloudflarePagesPreviewRecord({
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    sourceRunId: opts.sourceRunId,
  });
  const snapshot: CloudflarePagesControlPlaneSnapshot = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SNAPSHOT_SCHEMA,
    submissionId: createCloudflarePagesSubmissionId(),
    submittedAt: new Date().toISOString(),
    operationKind: "preview_cleanup",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    providerTargetIdentity: effectiveRunTarget.providerTargetIdentity,
    lockScope: opts.deployment.providerTarget.providerTargetIdentity,
    deployment: opts.deployment,
    paths: { workspaceRoot: opts.workspaceRoot, recordsRoot: opts.recordsRoot },
    action: {
      kind: "preview_cleanup",
      publishMode: "preview",
      effectiveRunTarget,
      previewIdentitySelector: cloudflarePagesPreviewIdentitySelector(opts.sourceRunId),
      cleanupReason: opts.cleanupReason,
      artifactIdentity: source.artifact.identity,
      artifactLineageId: source.artifactLineageId,
      ...(latestPreview?.providerReleaseId
        ? { providerReleaseId: latestPreview.providerReleaseId }
        : {}),
      ...(latestPreview?.deployRunId ? { parentRunId: latestPreview.deployRunId } : {}),
      ...(latestPreview?.releaseLineageId
        ? { releaseLineageId: latestPreview.releaseLineageId }
        : {}),
      sourceRecordPath: source.sourceRecordPath,
      sourceReplaySnapshotPath: source.sourceReplaySnapshotPath,
    },
  };
  return await withCloudflarePagesControlPlaneRun(
    opts.deployment,
    opts.recordsRoot,
    snapshot,
    async (authority) => {
      try {
        await cleanupCloudflarePagesPreview({
          deployment: opts.deployment,
          effectiveRunTarget,
          providerReleaseId: latestPreview?.providerReleaseId,
        });
        const record = previewCleanupRecord({
          deployment: opts.deployment,
          authority,
          admittedContext: source.sourceRecord.admittedContext,
          artifactIdentity: source.artifact.identity,
          artifactLineageId: source.artifactLineageId,
          ...(latestPreview?.deployRunId ? { parentRunId: latestPreview.deployRunId } : {}),
          ...(latestPreview?.releaseLineageId
            ? { releaseLineageId: latestPreview.releaseLineageId }
            : {}),
          effectiveRunTarget,
          sourceRunId: opts.sourceRunId,
          cleanupReason: opts.cleanupReason,
          finalOutcome: "succeeded",
        });
        return {
          record,
          recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const record = previewCleanupRecord({
          deployment: opts.deployment,
          authority,
          admittedContext: source.sourceRecord.admittedContext,
          artifactIdentity: source.artifact.identity,
          artifactLineageId: source.artifactLineageId,
          ...(latestPreview?.deployRunId ? { parentRunId: latestPreview.deployRunId } : {}),
          ...(latestPreview?.releaseLineageId
            ? { releaseLineageId: latestPreview.releaseLineageId }
            : {}),
          effectiveRunTarget,
          sourceRunId: opts.sourceRunId,
          cleanupReason: opts.cleanupReason,
          finalOutcome: "publish_failed",
          error: message,
        });
        const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
        throw Object.assign(error instanceof Error ? error : new Error(message), {
          record,
          recordPath,
        });
      }
    },
  );
}
