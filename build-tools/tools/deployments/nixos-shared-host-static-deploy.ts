#!/usr/bin/env zx-wrapper
import {
  requireNixosSharedHostControlPlaneAuthority,
  type NixosSharedHostSmokeConnectOverride,
  type NixosSharedHostControlPlaneWorkerAuthority,
} from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import {
  requireNixosSharedHostAdmittedArtifactPath,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import { primaryNixosSharedHostComponent } from "./nixos-shared-host-components.ts";
import {
  failedStepFromError,
  finalOutcomeForFailedStep,
  withFailedStep,
} from "./nixos-shared-host-deploy-failure.ts";
import {
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";
import { applyNixosSharedHostScopedDeployments } from "./nixos-shared-host-platform.ts";
import {
  publishNixosSharedHostArtifacts,
  smokeNixosSharedHostPublishedComponents,
} from "./nixos-shared-host-publish-components.ts";
import { runNixosSharedHostReleaseActionPhase } from "./nixos-shared-host-release-actions.ts";
import {
  createNixosSharedHostDeployRecord,
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan.ts";
import {
  captureStaticDeployReplaySnapshot,
  staticDeployRecordFields,
} from "./nixos-shared-host-static-deploy-records.ts";
import { writeNixosSharedHostReplayComponentResults } from "./nixos-shared-host-replay.ts";
import { materializeNixosSharedHostRuntime } from "./nixos-shared-host-runtime.ts";
import { renderNixosSharedHostConfig } from "./nixos-shared-host.ts";

type StaticOperationKind = "deploy" | "promotion" | "retry" | "rollback";
type StaticPublishBehavior = "deploy" | "publish-only";

export async function runNixosSharedHostStaticDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  operationKind?: StaticOperationKind;
  publishBehavior?: StaticPublishBehavior;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity?: string;
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  hostConfigPath?: string;
  authority?: NixosSharedHostControlPlaneWorkerAuthority;
  admittedContext?: NixosSharedHostAdmittedContext;
  sourceComponentResults?: NixosSharedHostComponentResult[];
  releaseActions?: DeploymentReleaseAction[];
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const authority = requireNixosSharedHostControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createNixosSharedHostDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  const publishBehavior = opts.publishBehavior || "deploy";
  const releaseActions = opts.releaseActions || opts.deployment.releaseActions;
  let deploymentMetadataFingerprint: string | undefined;
  let replaySnapshotPath: string | undefined;
  try {
    const componentArtifacts =
      opts.componentArtifacts ||
      (() => {
        const primary = primaryNixosSharedHostComponent(opts.deployment);
        return opts.artifact ? [{ componentId: primary.id, artifact: opts.artifact }] : [];
      })();
    const topLevelArtifactIdentity =
      opts.compositeArtifactIdentity ||
      opts.artifact?.identity ||
      componentArtifacts[0]?.artifact.identity;
    const current = await readNixosSharedHostPlatformStateOrEmpty(opts.statePath);
    const state =
      publishBehavior === "deploy"
        ? applyNixosSharedHostScopedDeployments(current, [opts.deployment])
        : current;
    if (publishBehavior === "deploy") await writeJsonDocument(opts.statePath, state);
    const rendered = renderNixosSharedHostConfig(state);
    if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
    if (publishBehavior === "publish-only" && Object.keys(rendered.containers).length === 0) {
      throw withFailedStep(
        "publish",
        new Error(`publish-only requires an existing realized target: ${authority.lockScope}`),
      );
    }
    ({ deploymentMetadataFingerprint, replaySnapshotPath } =
      await captureStaticDeployReplaySnapshot({
        recordsRoot: opts.recordsRoot,
        deployRunId: runId,
        deployment: opts.deployment,
        artifact: opts.artifact,
        componentArtifacts,
        compositeArtifactIdentity: opts.compositeArtifactIdentity,
        admittedContext: opts.admittedContext!,
        platformState: state,
        hostConfig: rendered,
        provisionerPlan: opts.provisionerPlan,
        controlPlaneExecutionSnapshotPath: authority.executionSnapshotPath,
      }));
    if (publishBehavior === "deploy") {
      await materializeNixosSharedHostRuntime(opts.hostRoot, rendered).catch((error) => {
        throw withFailedStep("provision", error);
      });
    }
    for (const componentArtifact of componentArtifacts) {
      await requireNixosSharedHostAdmittedArtifactPath(componentArtifact.artifact);
    }
    await runNixosSharedHostReleaseActionPhase({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      operationKind,
      phase: "pre_publish",
      releaseActions,
      artifactIdentity: topLevelArtifactIdentity,
    }).catch((error) => {
      throw withFailedStep("release_actions.pre_publish", error);
    });
    const published = await publishNixosSharedHostArtifacts({
      deployment: opts.deployment,
      rendered,
      hostRoot: opts.hostRoot,
      componentArtifacts,
      ...(opts.sourceComponentResults
        ? { sourceComponentResults: opts.sourceComponentResults }
        : {}),
      allowLiveComponentReuse:
        publishBehavior === "publish-only" &&
        componentArtifacts.length > 1 &&
        releaseActions.length === 0,
    }).catch((error) => {
      throw withFailedStep((error as any)?.failedStep || "publish", error);
    });
    await runNixosSharedHostReleaseActionPhase({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      operationKind,
      phase: "post_publish_pre_smoke",
      releaseActions,
      artifactIdentity: topLevelArtifactIdentity,
    }).catch((error) => {
      throw withFailedStep("release_actions.post_publish_pre_smoke", error);
    });
    const smoke = await smokeNixosSharedHostPublishedComponents({
      deployment: opts.deployment,
      published,
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    }).catch((error) => {
      throw withFailedStep((error as any)?.failedStep || "smoke", error);
    });
    await runNixosSharedHostReleaseActionPhase({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      operationKind,
      phase: "post_smoke",
      releaseActions,
      artifactIdentity: topLevelArtifactIdentity,
      publicUrl: smoke.publicUrl,
    }).catch((error) => {
      throw withFailedStep("release_actions.post_smoke", error);
    });
    if (replaySnapshotPath && smoke.componentResults.length > 0)
      await writeNixosSharedHostReplayComponentResults(replaySnapshotPath, smoke.componentResults);
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: "succeeded",
      ...staticDeployRecordFields({
        deployBatchId: opts.deployBatchId,
        parentRunId: opts.parentRunId,
        releaseLineageId: opts.releaseLineageId,
        artifactIdentity: topLevelArtifactIdentity,
        artifact: opts.artifact,
        artifactLineageId: opts.artifactLineageId,
        admittedContext: opts.admittedContext,
        provisionerPlan: opts.provisionerPlan,
        deploymentMetadataFingerprint,
        replaySnapshotPath,
      }),
      componentResults: smoke.componentResults,
      publicUrl: smoke.publicUrl,
      healthUrl: smoke.healthUrl,
      authority,
    });
    return {
      record,
      recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedStep = failedStepFromError(error);
    const componentResults = (error as any)?.componentResults as
      | NixosSharedHostComponentResult[]
      | undefined;
    if (replaySnapshotPath && componentResults?.length) {
      await writeNixosSharedHostReplayComponentResults(replaySnapshotPath, componentResults);
    }
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      operationKind,
      runClassification: operationKind,
      finalOutcome: finalOutcomeForFailedStep(failedStep),
      ...staticDeployRecordFields({
        deployBatchId: opts.deployBatchId,
        parentRunId: opts.parentRunId,
        releaseLineageId: opts.releaseLineageId,
        artifactIdentity: opts.compositeArtifactIdentity || opts.artifact?.identity,
        artifact: opts.artifact,
        artifactLineageId: opts.artifactLineageId,
        admittedContext: opts.admittedContext,
        provisionerPlan: opts.provisionerPlan,
        deploymentMetadataFingerprint,
        replaySnapshotPath,
      }),
      ...(componentResults ? { componentResults } : {}),
      failedStep,
      error: message,
      authority,
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
