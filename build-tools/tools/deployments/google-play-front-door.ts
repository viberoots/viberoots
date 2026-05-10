#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { printDeployJson } from "./deploy-front-door";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve";
import { summarizeDeploymentResult } from "./deployment-execution";
import type { GooglePlayDeployment } from "./contract";
import { invalidatingTargetException } from "./deployment-target-exceptions";
import { resolveCrossDeploymentPromotionSelection } from "./deployment-promotion";
import { resolveGooglePlayReplaySource } from "./google-play-replay";
import { submitGooglePlayDeploy } from "./google-play-deploy";
import { submitGooglePlayExactArtifactRun } from "./google-play-exact-run";

function sameDeploymentRollbackErrors(
  current: GooglePlayDeployment,
  sourceDeployment: GooglePlayDeployment,
): string[] {
  const currentTargetIdentity = current.providerTarget.providerTargetIdentity;
  const sourceTargetIdentity = sourceDeployment.providerTarget.providerTargetIdentity;
  const invalidatingException = invalidatingTargetException(
    current.targetExceptions,
    sourceTargetIdentity,
    currentTargetIdentity,
  );
  const errors: string[] = [];
  if (sourceDeployment.deploymentId !== current.deploymentId) {
    errors.push(
      `rollback source run must belong to ${current.deploymentId}, got ${sourceDeployment.deploymentId}`,
    );
  }
  if (sourceTargetIdentity !== currentTargetIdentity) {
    errors.push(
      invalidatingException
        ? `recorded target binding ${sourceTargetIdentity} was invalidated by ${invalidatingException.ref}`
        : `provider target mismatch: current=${currentTargetIdentity} source=${sourceTargetIdentity}`,
    );
  }
  return errors;
}

export async function runGooglePlayDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  publishOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
}) {
  if (
    getFlagBool("preview") ||
    getFlagBool("preview-cleanup") ||
    getFlagBool("remove") ||
    getFlagBool("bootstrap") ||
    getFlagStr("bootstrap-reconcile-run-id", "").trim()
  ) {
    throw new Error(
      "google-play deploys support only normal deploy and --publish-only reuse flows",
    );
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "google-play", "records"),
    ),
  );
  const controlPlaneDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim() ||
    undefined;
  if (!opts.publishOnly) {
    const result = await submitGooglePlayDeploy({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactPath: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment),
      recordsRoot,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    printDeployJson(summarizeDeploymentResult(result));
    return;
  }
  if (!opts.sourceRunId) {
    throw new Error(
      opts.rollback
        ? "google-play rollback requires --source-run-id"
        : "google-play --publish-only requires --source-run-id",
    );
  }
  if (opts.artifactDirFlag) {
    throw new Error(
      "google-play --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  if (opts.rollback) {
    const source = await resolveGooglePlayReplaySource({
      recordsRoot,
      deployRunId: opts.sourceRunId,
    });
    const errors = [
      ...sameDeploymentRollbackErrors(opts.deployment, source.replaySnapshot.deployment),
      ...(source.record.finalOutcome !== "succeeded"
        ? [`source run is not successful: ${source.record.finalOutcome}`]
        : []),
      ...(source.record.runClassification !== "deploy"
        ? [`wrong run classification: ${source.record.runClassification}`]
        : []),
      ...(source.record.publishMode !== "normal"
        ? [`rollback source must use publish_mode normal, got ${source.record.publishMode}`]
        : []),
    ];
    if (errors.length > 0)
      throw new Error(
        `rollback source run is not eligible: ${source.record.deployRunId}\n${errors.join("\n")}`,
      );
    const result = await submitGooglePlayExactArtifactRun({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot,
      operationKind: "rollback",
      artifact: source.replaySnapshot.artifact,
      sourceRecord: source.record,
      parentRunId: source.record.deployRunId,
      releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
      artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
      sourceTrack: source.replaySnapshot.deployment.providerTarget.track,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    printDeployJson(summarizeDeploymentResult(result));
    return;
  }
  const source = await resolveGooglePlayReplaySource({
    recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const result =
    source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
      ? await submitGooglePlayExactArtifactRun({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          recordsRoot,
          operationKind: "retry",
          artifact: source.replaySnapshot.artifact,
          sourceRecord: source.record,
          parentRunId: source.record.deployRunId,
          releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
          artifactLineageId:
            source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
          sourceTrack: source.replaySnapshot.deployment.providerTarget.track,
          ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
        })
      : await (async () => {
          const promotion = await resolveCrossDeploymentPromotionSelection({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            recordsRoot,
            sourceRunId: opts.sourceRunId,
            ...(controlPlaneDatabaseUrl ? { backendDatabaseUrl: controlPlaneDatabaseUrl } : {}),
          });
          return await submitGooglePlayExactArtifactRun({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            recordsRoot,
            operationKind: "promotion",
            artifact: promotion.artifact as any,
            sourceRecord: promotion.sourceRecord as any,
            parentRunId: promotion.parentRunId,
            releaseLineageId: promotion.releaseLineageId,
            artifactLineageId: promotion.artifactLineageId,
            sourceTrack: (promotion.sourceReplaySnapshot as any).deployment.providerTarget.track,
            ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
          });
        })();
  printDeployJson(summarizeDeploymentResult(result));
}
