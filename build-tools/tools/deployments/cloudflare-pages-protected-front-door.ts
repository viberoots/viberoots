#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type CloudflarePagesControlPlaneSubmitRequest,
} from "./cloudflare-pages-control-plane-api-contract";
import { createCloudflarePagesSubmissionId } from "./cloudflare-pages-control-plane-shared";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract";
import { summarizeDeploymentResult } from "./deployment-execution";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "./nixos-shared-host-control-plane-client";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "./deployment-service-client-selection";
import { uploadCloudflarePagesClientArtifact } from "./cloudflare-pages-artifact-upload-client";
import { serviceSubmissionAdmissionEvidence } from "./deployment-service-client-contract";
import { terminalControlPlaneRejectionMessage } from "./deployment-provider-protected-front-door";
import { controlPlaneRecordFailureMessage } from "./deployment-control-plane-record-failure";

const SERVICE_ONLY_LOCAL_FLAGS = ["records-root", "control-plane-database-url"] as const;

function rejectServiceOnlyLocalFlags(hasFlag: (flag: string) => boolean) {
  const conflicts = SERVICE_ONLY_LOCAL_FLAGS.filter((flag) => hasFlag(flag));
  if (conflicts.length === 0) return;
  throw new Error(
    `service-only cloudflare-pages deploy does not support ${conflicts.map((flag) => `--${flag}`).join(", ")}`,
  );
}

async function readFinalizedRecord(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployRunId: string;
}) {
  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      return await readNixosSharedHostControlPlaneRecordViaService({
        controlPlaneUrl: opts.controlPlaneUrl,
        ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
        deployRunId: opts.deployRunId,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("record not found")) throw error;
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function finalizeServiceResponse(
  controlPlaneUrl: string,
  controlPlaneToken: string | undefined,
  status: DeploymentControlPlaneStatus,
) {
  const rejectionMessage = terminalControlPlaneRejectionMessage(status);
  if (rejectionMessage) throw Object.assign(new Error(rejectionMessage), { status });
  if (!status.deployRunId) return status;
  const record = await readFinalizedRecord({
    controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    deployRunId: status.deployRunId,
  });
  if (record.finalOutcome !== "succeeded") {
    throw Object.assign(new Error(controlPlaneRecordFailureMessage(record)), {
      status,
      record,
    });
  }
  return summarizeDeploymentResult({ record });
}

export async function runProtectedCloudflarePagesDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  retireTarget: boolean;
  migrateTarget: boolean;
  targetExceptionRef: string;
  sourceRunId: string;
  cleanupReason: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  allowControlPlaneOverride?: boolean;
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag);
  const admissionEvidence = serviceSubmissionAdmissionEvidence(opts.admissionEvidence as any);
  const serviceClient = await resolveProtectedSharedServiceClient({
    deployment: opts.deployment,
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    workspaceRoot: opts.workspaceRoot,
    context: `cloudflare-pages ${opts.deployment.protectionClass} mutation`,
  });
  const submissionId = createCloudflarePagesSubmissionId();
  const needsArtifactInput =
    !opts.publishOnly &&
    !opts.preview &&
    !opts.previewCleanup &&
    !opts.retireTarget &&
    !opts.migrateTarget;
  const artifactInput = needsArtifactInput
    ? await uploadCloudflarePagesClientArtifact({
        workspaceRoot: opts.workspaceRoot,
        controlPlaneUrl: serviceClient.controlPlaneUrl,
        ...(serviceClient.controlPlaneToken
          ? { controlPlaneToken: serviceClient.controlPlaneToken }
          : {}),
        submissionId,
        deployment: opts.deployment,
        artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment),
      })
    : undefined;
  const request: CloudflarePagesControlPlaneSubmitRequest = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId,
    submittedAt: new Date().toISOString(),
    deployment: opts.deployment,
    operationKind: opts.retireTarget
      ? "retire_target"
      : opts.migrateTarget
        ? "migrate_target"
        : opts.previewCleanup
          ? "preview_cleanup"
          : opts.rollback
            ? "rollback"
            : opts.publishOnly || opts.sourceRunId
              ? "promotion"
              : "deploy",
    ...(artifactInput ? { artifactInput } : {}),
    ...(artifactInput && "sourceRevision" in artifactInput
      ? { expectedSourceRevision: artifactInput.sourceRevision }
      : {}),
    ...(opts.publishOnly ? { publishBehavior: "publish-only" as const } : {}),
    ...(opts.preview ? { publishMode: "preview" as const } : {}),
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.targetExceptionRef ? { targetExceptionRef: opts.targetExceptionRef } : {}),
    ...(opts.previewCleanup ? { cleanupReason: opts.cleanupReason as any } : {}),
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
    controlPlaneSelection: serviceClientSelectionEvidence(serviceClient),
  };
  const { final } = await submitNixosSharedHostControlPlaneViaService({
    controlPlaneUrl: serviceClient.controlPlaneUrl,
    token: serviceClient.controlPlaneToken,
    request: request as any,
  });
  return await finalizeServiceResponse(
    serviceClient.controlPlaneUrl,
    serviceClient.controlPlaneToken,
    final,
  );
}
