#!/usr/bin/env zx-wrapper
import { cleanupCloudflarePagesPreview } from "./cloudflare-pages-preview-cleanup.ts";
import { createBackendPreviewCleanupRecord } from "./cloudflare-pages-control-plane-backend-records.ts";
import { writeCloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import { requireCloudflarePagesApiTokenForStep } from "./cloudflare-pages-secret-steps.ts";

export async function executeCloudflarePagesBackendPreviewCleanup(opts: {
  recordsRoot: string;
  workerId: string;
  snapshot: any;
}) {
  const context = opts.snapshot.sourceRecord?.admittedContext || opts.snapshot.admittedContext;
  const common = {
    deployment: opts.snapshot.deployment,
    submissionId: opts.snapshot.submissionId,
    workerId: opts.workerId,
    lockScope: opts.snapshot.lockScope,
    admittedContext: context,
    artifactIdentity: opts.snapshot.action.artifactIdentity,
    artifactLineageId: opts.snapshot.action.artifactLineageId,
    effectiveRunTarget: opts.snapshot.action.effectiveRunTarget,
    sourceRunId: opts.snapshot.action.previewIdentitySelector.sourceRunId,
    cleanupReason: opts.snapshot.action.cleanupReason,
  };
  try {
    const apiToken = await requireCloudflarePagesApiTokenForStep({
      admittedContext: context,
      step: "preview_cleanup",
      authority: {
        kind: "control-plane-worker",
        submissionId: opts.snapshot.submissionId,
        workerId: opts.workerId,
        lockScope: opts.snapshot.lockScope,
        executionSnapshotPath: "",
      },
      requirements: opts.snapshot.deployment.secretRequirements,
    });
    await cleanupCloudflarePagesPreview({
      deployment: opts.snapshot.deployment,
      effectiveRunTarget: opts.snapshot.action.effectiveRunTarget,
      providerReleaseId: opts.snapshot.action.providerReleaseId,
      apiToken,
    });
    const record = createBackendPreviewCleanupRecord({
      ...common,
      ...(opts.snapshot.action.parentRunId
        ? { parentRunId: opts.snapshot.action.parentRunId }
        : {}),
      ...(opts.snapshot.action.releaseLineageId
        ? { releaseLineageId: opts.snapshot.action.releaseLineageId }
        : {}),
      finalOutcome: "succeeded",
    });
    return { record, recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record = createBackendPreviewCleanupRecord({
      ...common,
      finalOutcome: "publish_failed",
      error: message,
    });
    const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
