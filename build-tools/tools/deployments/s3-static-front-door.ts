#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { S3StaticDeployment } from "./contract";
import { assertCrossDeploymentExactPromotionEligible } from "./deployment-provider-promotion";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { summarizeDeploymentResult } from "./deployment-execution";
import { printDeployJson } from "./deploy-front-door";
import { submitS3StaticDeploy } from "./s3-static-deploy";
import { submitS3StaticExactArtifactRun } from "./s3-static-exact-run";
import { submitS3StaticProvisionOnly } from "./s3-static-provision-only";
import { runProtectedS3StaticDeployFrontDoor } from "./s3-static-protected-front-door";
import { resolveS3StaticReplaySource } from "./s3-static-replay";

export async function runS3StaticDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  requireServiceForProtectedShared: boolean;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag?: (flag: string) => boolean;
}) {
  if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
    throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
  }
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("s3-static deploys do not support --preview or --preview-cleanup");
  }
  if (getFlagBool("remove")) throw new Error("s3-static deploys do not support --remove yet");
  if (opts.rollback && !opts.publishOnly) {
    throw new Error("s3-static rollback requires --publish-only");
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "s3-static", "records"),
    ),
  );
  const controlPlaneUrl =
    getFlagStr("control-plane-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_URL || "").trim();
  if (
    opts.deployment.protectionClass !== "local_only" &&
    (opts.requireServiceForProtectedShared || !!controlPlaneUrl)
  ) {
    printDeployJson(
      await runProtectedS3StaticDeployFrontDoor({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        publishOnly: opts.publishOnly,
        provisionOnly: opts.provisionOnly,
        rollback: opts.rollback,
        sourceRunId: opts.sourceRunId,
        controlPlaneUrl,
        controlPlaneToken: getFlagStr("control-plane-token", "").trim() || undefined,
        admissionEvidence: opts.admissionEvidence,
        smokeConnectOverride: opts.smokeConnectOverride,
        hasFlag: opts.hasFlag || (() => false),
      }),
    );
    return;
  }
  if (opts.provisionOnly) {
    const result = await submitS3StaticProvisionOnly({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    printDeployJson(summarizeDeploymentResult(result));
    return;
  }
  if (opts.publishOnly) {
    if (!opts.sourceRunId) {
      throw new Error(
        opts.rollback
          ? "s3-static rollback requires --source-run-id"
          : "s3-static --publish-only requires --source-run-id",
      );
    }
    if (opts.artifactDirFlag) {
      throw new Error(
        "s3-static --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
      );
    }
    const source = await resolveS3StaticReplaySource({
      recordsRoot,
      deployRunId: opts.sourceRunId,
    });
    if (opts.rollback) {
      const errors = [
        ...(source.replaySnapshot.deployment.deploymentId !== opts.deployment.deploymentId
          ? [
              `rollback source run must belong to ${opts.deployment.deploymentId}, got ${source.replaySnapshot.deployment.deploymentId}`,
            ]
          : []),
        ...(source.record.finalOutcome !== "succeeded"
          ? [`source run is not successful: ${source.record.finalOutcome}`]
          : []),
        ...(source.record.runClassification !== "deploy"
          ? [`wrong run classification: ${source.record.runClassification}`]
          : []),
      ];
      if (errors.length > 0) {
        throw new Error(
          `rollback source run is not eligible: ${source.record.deployRunId}\n${errors.join("\n")}`,
        );
      }
    } else if (source.replaySnapshot.deployment.deploymentId !== opts.deployment.deploymentId) {
      await assertCrossDeploymentExactPromotionEligible({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        source,
      });
    }
    const result = await submitS3StaticExactArtifactRun({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot,
      operationKind: opts.rollback
        ? "rollback"
        : source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
          ? "retry"
          : "promotion",
      artifact: source.replaySnapshot.artifact,
      sourceRecord: source.record,
      parentRunId: source.record.deployRunId,
      releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
      artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
    });
    printDeployJson(summarizeDeploymentResult(result));
    return;
  }
  const result = await submitS3StaticDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactDir:
      opts.artifactDirFlag || (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment)),
    recordsRoot,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}
