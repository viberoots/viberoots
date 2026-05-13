#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import type { KubernetesDeployment } from "./contract";
import { assertCrossDeploymentExactPromotionEligible } from "./deployment-provider-promotion";
import { summarizeDeploymentResult } from "./deployment-execution";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve";
import { printDeployJson } from "./deploy-front-door";
import { submitKubernetesDeploy } from "./kubernetes-deploy";
import { submitKubernetesExactArtifactRun } from "./kubernetes-exact-run";
import { submitKubernetesProvisionOnly } from "./kubernetes-provision-only";
import { readPreparedKubernetesPublisherConfigSnapshot } from "./kubernetes-config";
import { runProtectedKubernetesDeployFrontDoor } from "./kubernetes-protected-front-door";
import { resolveKubernetesReplaySource } from "./kubernetes-replay";

export async function runKubernetesDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  requireServiceForProtectedShared: boolean;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  backendDatabaseUrl?: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag?: (flag: string) => boolean;
}) {
  if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
    throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
  }
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("kubernetes deploys do not support --preview or --preview-cleanup");
  }
  if (getFlagBool("remove")) throw new Error("kubernetes deploys do not support --remove yet");
  if (opts.rollback && !opts.publishOnly) {
    throw new Error("kubernetes rollback requires --publish-only");
  }
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "kubernetes", "records"),
    ),
  );
  const controlPlaneUrl =
    getFlagStr("control-plane-url", "").trim() ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim();
  if (
    opts.deployment.protectionClass !== "local_only" &&
    (opts.requireServiceForProtectedShared || !!controlPlaneUrl)
  ) {
    printDeployJson(
      await runProtectedKubernetesDeployFrontDoor({
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
    const result = await submitKubernetesProvisionOnly({
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
          ? "kubernetes rollback requires --source-run-id"
          : "kubernetes --publish-only requires --source-run-id",
      );
    }
    if (opts.artifactDirFlag) {
      throw new Error(
        "kubernetes --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
      );
    }
    const source = await resolveKubernetesReplaySource({
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
        recordsRoot,
        backendDatabaseUrl: opts.backendDatabaseUrl,
        source,
      });
    }
    const result = await submitKubernetesExactArtifactRun({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      recordsRoot,
      operationKind: opts.rollback
        ? "rollback"
        : source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
          ? "retry"
          : "promotion",
      componentArtifacts: source.replaySnapshot.componentArtifacts,
      sourceRecord: source.record,
      parentRunId: source.record.deployRunId,
      releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
      artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifactIdentity,
      ...(source.replaySnapshot.deployment.deploymentId === opts.deployment.deploymentId
        ? {
            preparedPublisherConfig: await readPreparedKubernetesPublisherConfigSnapshot(
              source.replaySnapshot.providerConfigSnapshotPath,
            ),
          }
        : {}),
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
    });
    printDeployJson(summarizeDeploymentResult(result));
    return;
  }
  const result = await submitKubernetesDeploy({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    recordsRoot,
    ...(opts.deployment.components.length > 1
      ? {
          artifactDirsByComponentId: await resolveComponentArtifactDirsForCli(
            opts.workspaceRoot,
            opts.deployment,
          ),
        }
      : {
          artifactDir:
            opts.artifactDirFlag ||
            (await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment)),
        }),
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  printDeployJson(summarizeDeploymentResult(result));
}
