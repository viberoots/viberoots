#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type CloudflarePagesControlPlaneSubmitRequest,
} from "./cloudflare-pages-control-plane-api-contract.ts";
import { createCloudflarePagesSubmissionId } from "./cloudflare-pages-control-plane-shared.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "./nixos-shared-host-control-plane-client.ts";
import { resolveServiceClientFromFlags } from "./nixos-shared-host-service-client-config.ts";

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
  if (!status.deployRunId) return status;
  const record = await readFinalizedRecord({
    controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    deployRunId: status.deployRunId,
  });
  if (record.finalOutcome !== "succeeded") {
    const details =
      typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : typeof record.smokeError === "string" && record.smokeError.trim()
          ? record.smokeError.trim()
          : `final outcome: ${String(record.finalOutcome || "unknown")}`;
    throw Object.assign(new Error(`shared control-plane mutation failed: ${details}`), {
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
  hasFlag: (flag: string) => boolean;
}) {
  rejectServiceOnlyLocalFlags(opts.hasFlag);
  const serviceClient = resolveServiceClientFromFlags({
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    context: `cloudflare-pages ${opts.deployment.protectionClass} mutation`,
  });
  const request: CloudflarePagesControlPlaneSubmitRequest = {
    schemaVersion: CLOUDFLARE_PAGES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: createCloudflarePagesSubmissionId(),
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
    ...(!opts.publishOnly &&
    !opts.preview &&
    !opts.previewCleanup &&
    !opts.retireTarget &&
    !opts.migrateTarget
      ? { artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment) }
      : {}),
    ...(opts.publishOnly ? { publishBehavior: "publish-only" as const } : {}),
    ...(opts.preview ? { publishMode: "preview" as const } : {}),
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.targetExceptionRef ? { targetExceptionRef: opts.targetExceptionRef } : {}),
    ...(opts.previewCleanup ? { cleanupReason: opts.cleanupReason as any } : {}),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
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
