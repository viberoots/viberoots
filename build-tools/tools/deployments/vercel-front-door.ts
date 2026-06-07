#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import type { VercelDeployment } from "./contract";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import type { DeployCliReadonlyFlags } from "./deploy-cli-readonly";
import { printDeployJson } from "./deploy-front-door";
import { summarizeDeploymentResult } from "./deployment-execution";
import {
  submitVercelDeploy,
  submitVercelPreviewCleanup,
  summarizeVercelResult,
} from "./vercel-deploy";
import { submitVercelExactArtifactRun } from "./vercel-exact-run";
import { resolveVercelReplaySource } from "./vercel-replay";
import { runProtectedVercelDeployFrontDoor } from "./vercel-protected-front-door";
import { shouldUseProtectedSharedServiceRoute } from "./deployment-service-client-selection";

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
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  allowControlPlaneOverride: boolean;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag?: (flag: string) => boolean;
}) {
  if (opts.rollback && !opts.publishOnly) {
    throw new Error("vercel rollback requires --publish-only");
  }
  if (
    shouldUseProtectedSharedServiceRoute({
      deployment: opts.deployment,
      requireServiceForProtectedShared: opts.requireServiceForProtectedShared,
      controlPlaneUrl: opts.controlPlaneUrl,
    })
  ) {
    printDeployJson(
      await runProtectedVercelDeployFrontDoor({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        publishOnly: opts.publishOnly,
        preview: opts.preview,
        previewCleanup: opts.previewCleanup,
        rollback: opts.rollback,
        sourceRunId: opts.sourceRunId,
        artifactDirFlag: opts.artifactDirFlag,
        controlPlaneUrl: opts.controlPlaneUrl,
        controlPlaneToken: opts.controlPlaneToken,
        allowControlPlaneOverride: opts.allowControlPlaneOverride,
        admissionEvidence: opts.admissionEvidence,
        smokeConnectOverride: opts.smokeConnectOverride,
        hasFlag: opts.hasFlag || (() => false),
      }),
    );
    return;
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
  if (opts.publishOnly) {
    if (!opts.sourceRunId) {
      throw new Error(
        opts.rollback
          ? "vercel rollback requires --source-run-id"
          : "vercel --publish-only requires --source-run-id",
      );
    }
    if (opts.artifactDirFlag) {
      throw new Error(
        "vercel --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
      );
    }
    const source = await resolveVercelReplaySource({ recordsRoot, deployRunId: opts.sourceRunId });
    if (
      opts.rollback &&
      source.replaySnapshot.deployment.deploymentId !== opts.deployment.deploymentId
    ) {
      throw new Error(
        `vercel rollback source run must belong to ${opts.deployment.deploymentId}, got ${source.replaySnapshot.deployment.deploymentId}`,
      );
    }
    const operationKind = opts.rollback
      ? "rollback"
      : source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
        ? "retry"
        : "promotion";
    const result = await submitVercelExactArtifactRun({
      deployment: opts.deployment,
      recordsRoot,
      operationKind,
      replaySnapshot: source.replaySnapshot,
      parentRunId: source.record.deployRunId,
      releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
      artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
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
    operationKind: opts.preview ? "preview" : "deploy",
    ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(summarizeVercelResult(result)));
}

export async function runVercelDeployFrontDoorForCli(
  workspaceRoot: string,
  deployment: VercelDeployment,
  flags: DeployCliReadonlyFlags,
  publicFrontDoor: boolean,
  hasFlag?: (flag: string) => boolean,
  admissionEvidence?: unknown,
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
    controlPlaneUrl: flags.controlPlaneUrl,
    controlPlaneToken: flags.controlPlaneToken,
    allowControlPlaneOverride: flags.allowControlPlaneOverride,
    ...(hasFlag ? { hasFlag } : {}),
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
  });
}
