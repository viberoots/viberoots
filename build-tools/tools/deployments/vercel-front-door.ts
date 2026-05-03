#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import type { VercelDeployment } from "./contract.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import type { DeployCliReadonlyFlags } from "./deploy-cli-readonly.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import {
  submitVercelDeploy,
  submitVercelPreviewCleanup,
  summarizeVercelResult,
} from "./vercel-deploy.ts";

export async function runVercelDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  requireServiceForProtectedShared: boolean;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  smokeConnectOverride?: unknown;
}) {
  if (opts.rollback && !opts.publishOnly)
    throw new Error("vercel rollback requires --publish-only");
  if (opts.requireServiceForProtectedShared && opts.deployment.protectionClass !== "local_only") {
    throw new Error(
      "protected/shared Vercel mutations must use the reviewed control-plane service",
    );
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "vercel", "records"),
    ),
  );
  if (opts.previewCleanup) {
    const result = await submitVercelPreviewCleanup({
      deployment: opts.deployment,
      recordsRoot,
      sourceRunId: opts.sourceRunId,
    });
    printDeployJson(summarizeDeploymentResult(summarizeVercelResult(result)));
    return;
  }
  const artifactDir =
    opts.artifactDirFlag || (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment));
  const result = await submitVercelDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot,
    artifactDir,
    operationKind: opts.preview ? "preview" : opts.rollback ? "rollback" : "deploy",
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}

export async function runVercelDeployFrontDoorForCli(
  workspaceRoot: string,
  deployment: VercelDeployment,
  flags: DeployCliReadonlyFlags,
  publicFrontDoor: boolean,
  smokeConnectOverride?: unknown,
) {
  await runVercelDeployFrontDoor({
    workspaceRoot,
    deployment,
    requireServiceForProtectedShared: publicFrontDoor,
    publishOnly: flags.publishOnly,
    preview: flags.preview,
    previewCleanup: flags.previewCleanup,
    rollback: flags.rollback,
    sourceRunId: flags.sourceRunId,
    artifactDirFlag: flags.artifactDirFlag,
    ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
  });
}
