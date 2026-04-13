#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import { runCloudflarePagesCli } from "./cloudflare-pages-cli.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import { syncBackendDeployRecordsFromRunMirrors } from "./nixos-shared-host-control-plane-backend.ts";
import { submitCloudflarePagesTargetTransition } from "./cloudflare-pages-target-transition.ts";

export async function runCloudflareDeployFrontDoor(opts: {
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
  artifactDirFlag: string;
  cleanupReason: string;
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
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
    ),
  );
  const controlPlaneDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim() ||
    undefined;
  const backendDatabaseUrl =
    opts.sourceRunId && controlPlaneDatabaseUrl
      ? await (async () => {
          await syncBackendDeployRecordsFromRunMirrors({
            recordsRoot,
            databaseUrl: controlPlaneDatabaseUrl,
          });
          return controlPlaneDatabaseUrl;
        })()
      : controlPlaneDatabaseUrl;
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
