#!/usr/bin/env zx-wrapper
import { type CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import {
  cloudflarePagesPreviewIdentitySelector,
  type CloudflarePagesPreviewCleanupReason,
} from "./cloudflare-pages-preview";
import {
  createCloudflarePagesDeployRecord,
  createCloudflarePagesDeployRunId,
} from "./cloudflare-pages-records";
import type { CloudflarePagesDeployment } from "./contract";
import { deploymentMetadataFingerprintFor } from "./nixos-shared-host-deployment-fingerprint";

export function createBackendPreviewCleanupRecord(opts: {
  deployment: CloudflarePagesDeployment;
  submissionId: string;
  workerId: string;
  lockScope: string;
  admittedContext: CloudflarePagesAdmittedContext;
  artifactIdentity: string;
  artifactLineageId: string;
  parentRunId?: string;
  releaseLineageId?: string;
  effectiveRunTarget: CloudflarePagesDeployment["providerTarget"];
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
    authority: {
      kind: "control-plane-worker",
      submissionId: opts.submissionId,
      submissionPath: "",
      workerId: opts.workerId,
      lockScope: opts.lockScope,
      executionSnapshotPath: "",
    },
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

export function sanitizedBackendRecord<T extends { controlPlane?: Record<string, unknown> }>(
  record: T,
): T {
  if (!record.controlPlane) return record;
  const { submissionId, workerId, lockScope, admission, fencingToken } = record.controlPlane;
  return {
    ...record,
    controlPlane: { submissionId, workerId, lockScope, admission, fencingToken },
  };
}
