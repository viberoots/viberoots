#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import { resolveArtifactDirForCli } from "./deployment-cli-resolve.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import type { AppStoreConnectDeployment } from "./contract.ts";
import { invalidatingTargetException } from "./deployment-target-exceptions.ts";
import { resolveCrossDeploymentPromotionSelection } from "./deployment-promotion.ts";
import { resolveAppStoreConnectReplaySource } from "./app-store-connect-replay.ts";
import {
  submitAppStoreConnectDeploy,
  submitAppStoreConnectExactArtifactRun,
} from "./app-store-connect-deploy.ts";

function sameDeploymentRollbackErrors(
  current: AppStoreConnectDeployment,
  sourceDeployment: AppStoreConnectDeployment,
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

export async function runAppStoreConnectDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
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
      "app-store-connect deploys support only normal deploy and --publish-only reuse flows",
    );
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "app-store-connect", "records"),
    ),
  );
  if (!opts.publishOnly) {
    const result = await submitAppStoreConnectDeploy({
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
        ? "app-store-connect rollback requires --source-run-id"
        : "app-store-connect --publish-only requires --source-run-id",
    );
  }
  if (opts.artifactDirFlag) {
    throw new Error(
      "app-store-connect --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
    );
  }
  if (opts.rollback) {
    const source = await resolveAppStoreConnectReplaySource({
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
    if (errors.length > 0) {
      throw new Error(`rollback source run is not eligible: ${source.record.deployRunId}
${errors.join("\n")}`);
    }
    const result = await submitAppStoreConnectExactArtifactRun({
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
  const source = await resolveAppStoreConnectReplaySource({
    recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const result =
    source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
      ? await submitAppStoreConnectExactArtifactRun({
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
          });
          return await submitAppStoreConnectExactArtifactRun({
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
