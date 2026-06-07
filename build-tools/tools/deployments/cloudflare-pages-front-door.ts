#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import type { CloudflarePagesDeployment } from "./contract";
import { printDeployJson } from "./deploy-front-door";
import { runCloudflarePagesCli } from "./cloudflare-pages-cli";
import { summarizeDeploymentResult } from "./deployment-execution";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { runProtectedCloudflarePagesDeployFrontDoor } from "./cloudflare-pages-protected-front-door";
import { submitCloudflarePagesTargetTransition } from "./cloudflare-pages-target-transition";
import { shouldUseProtectedSharedServiceRoute } from "./deployment-service-client-selection";

export async function runCloudflareDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  requireServiceForProtectedShared: boolean;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  retireTarget: boolean;
  migrateTarget: boolean;
  targetExceptionRef: string;
  sourceRunId: string;
  artifactDirFlag: string;
  cleanupReason: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  allowControlPlaneOverride: boolean;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  provisionOnly: boolean;
}) {
  if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
    throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
  }
  if (opts.provisionOnly) {
    throw new Error(
      "cloudflare-pages does not support --provision-only on the repo-level deploy front door",
    );
  }
  if (getFlagBool("remove"))
    throw new Error("cloudflare-pages deploys do not support --remove yet");
  if (opts.rollback && !opts.publishOnly)
    throw new Error("cloudflare-pages rollback requires --publish-only");
  if (
    shouldUseProtectedSharedServiceRoute({
      deployment: opts.deployment,
      requireServiceForProtectedShared: opts.requireServiceForProtectedShared,
      controlPlaneUrl: opts.controlPlaneUrl,
    })
  ) {
    printDeployJson(
      await runProtectedCloudflarePagesDeployFrontDoor({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        publishOnly: opts.publishOnly,
        preview: opts.preview,
        previewCleanup: opts.previewCleanup,
        rollback: opts.rollback,
        retireTarget: opts.retireTarget,
        migrateTarget: opts.migrateTarget,
        targetExceptionRef: opts.targetExceptionRef,
        sourceRunId: opts.sourceRunId,
        cleanupReason: opts.cleanupReason,
        admissionEvidence: opts.admissionEvidence,
        smokeConnectOverride: opts.smokeConnectOverride,
        controlPlaneUrl: opts.controlPlaneUrl,
        controlPlaneToken: opts.controlPlaneToken,
        allowControlPlaneOverride: opts.allowControlPlaneOverride,
        hasFlag,
      }),
    );
    return;
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
    ),
  );
  const controlPlaneDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim() ||
    undefined;
  const backendDatabaseUrl = controlPlaneDatabaseUrl;
  if (opts.retireTarget || opts.migrateTarget) {
    if (!opts.targetExceptionRef)
      throw new Error("--retire-target/--migrate-target requires --target-exception-ref");
    const result = await submitCloudflarePagesTargetTransition({
      deployment: opts.deployment,
      recordsRoot,
      operationKind: opts.retireTarget ? "retire_target" : "migrate_target",
      targetExceptionRef: opts.targetExceptionRef,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    printDeployJson({
      runId: result.record.deployRunId,
      deployRunId: result.record.deployRunId,
      operationKind: result.record.operationKind,
      runClassification: result.record.runClassification,
      finalOutcome: result.record.finalOutcome,
      recordPath: result.recordPath,
      controlPlane: result.record.controlPlane,
    });
    return;
  }
  const resolvedArtifactDir =
    opts.publishOnly || opts.preview || opts.previewCleanup
      ? undefined
      : await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment);
  const result = await runCloudflarePagesCli({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactDirFlag: opts.artifactDirFlag,
    resolvedArtifactDir,
    recordsRoot,
    ...(backendDatabaseUrl ? { backendDatabaseUrl } : {}),
    publishOnly: opts.publishOnly,
    rollback: opts.rollback,
    preview: opts.preview,
    previewCleanup: opts.previewCleanup,
    sourceRunId: opts.sourceRunId,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
    cleanupReason: opts.cleanupReason,
    provisionOnly: opts.provisionOnly,
  });
  printDeployJson(summarizeDeploymentResult(result));
}
