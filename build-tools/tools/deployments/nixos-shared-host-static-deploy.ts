#!/usr/bin/env zx-wrapper
import {
  requireNixosSharedHostControlPlaneAuthority,
  type NixosSharedHostSmokeConnectOverride,
  type NixosSharedHostMutationAuthority,
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
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout.ts";
import { primaryNixosSharedHostComponent } from "./nixos-shared-host-components.ts";
import { withFailedStep } from "./nixos-shared-host-deploy-failure.ts";
import {
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";
import { applyNixosSharedHostScopedDeployments } from "./nixos-shared-host-platform.ts";
import { smokeNixosSharedHostPublishedComponents } from "./nixos-shared-host-publish-components.ts";
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
import {
  failStaticDeployWithRecord,
  runStaticDeployProgressivePhases,
} from "./nixos-shared-host-static-deploy-progressive.ts";
import { renderNixosSharedHostConfig } from "./nixos-shared-host.ts";

type StaticOperationKind = "deploy" | "promotion" | "retry" | "rollback";
type StaticPublishBehavior = "deploy" | "publish-only";

export async function runNixosSharedHostStaticDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  deployRunId?: string;
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
  authority?: NixosSharedHostMutationAuthority;
  admittedContext?: NixosSharedHostAdmittedContext;
  sourceComponentResults?: NixosSharedHostComponentResult[];
  releaseActions?: DeploymentReleaseAction[];
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  gateEvaluator?: NixosSharedHostGateEvaluator;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const authority = requireNixosSharedHostControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = opts.deployRunId || createNixosSharedHostDeployRunId();
  const operationKind = opts.operationKind || "deploy";
  const publishBehavior = opts.publishBehavior || "deploy";
  const releaseActions = opts.releaseActions || opts.deployment.releaseActions;
  let deploymentMetadataFingerprint: string | undefined;
  let replaySnapshotPath: string | undefined;
  try {
    const runReleasePhase = async (
      phase: "pre_publish" | "post_publish_pre_smoke" | "post_smoke",
      extra: { artifactIdentity?: string; publicUrl?: string } = {},
    ) =>
      runNixosSharedHostReleaseActionPhase({
        recordsRoot: opts.recordsRoot,
        deployRunId: runId,
        deployment: opts.deployment,
        operationKind,
        phase,
        releaseActions,
        ...extra,
      }).catch((error) => {
        throw withFailedStep(`release_actions.${phase}`, error);
      });
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
    if (publishBehavior === "publish-only" && Object.keys(rendered.containers).length === 0)
      throw withFailedStep(
        "publish",
        new Error(`publish-only requires an existing realized target: ${authority.lockScope}`),
      );
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
        ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
        provisionerPlan: opts.provisionerPlan,
        controlPlaneExecutionSnapshotPath: authority.executionSnapshotPath,
      }));
    if (publishBehavior === "deploy")
      await materializeNixosSharedHostRuntime(opts.hostRoot, rendered).catch((error) => {
        throw withFailedStep("provision", error);
      });
    for (const componentArtifact of componentArtifacts) {
      await requireNixosSharedHostAdmittedArtifactPath(componentArtifact.artifact);
    }
    await runReleasePhase("pre_publish", { artifactIdentity: topLevelArtifactIdentity });
    const progressive = await runStaticDeployProgressivePhases({
      deployment: opts.deployment,
      rendered,
      hostRoot: opts.hostRoot,
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      operationKind,
      releaseActions,
      componentArtifacts,
      ...(opts.sourceComponentResults
        ? { sourceComponentResults: opts.sourceComponentResults }
        : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
      ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
      ...(replaySnapshotPath ? { replaySnapshotPath } : {}),
      replayState: {
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
      },
      authority,
    });
    await runReleasePhase("post_publish_pre_smoke", {
      artifactIdentity: topLevelArtifactIdentity,
    });
    const smoke = progressive.smoke
      ? progressive.smoke
      : await smokeNixosSharedHostPublishedComponents({
          deployment: opts.deployment,
          published: progressive.published,
          ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
        }).catch((error) => {
          throw withFailedStep((error as any)?.failedStep || "smoke", error);
        });
    await runReleasePhase("post_smoke", {
      artifactIdentity: topLevelArtifactIdentity,
      publicUrl: smoke.publicUrl,
    });
    if (replaySnapshotPath && smoke.componentResults.length > 0)
      await writeNixosSharedHostReplayComponentResults(
        replaySnapshotPath,
        smoke.componentResults,
        progressive?.rollout || opts.progressiveRollout,
      );
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
        progressiveRollout: progressive.progressiveRollout || opts.progressiveRollout,
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
    if ((error as any)?.paused || (error as any)?.recordPath) throw error;
    await failStaticDeployWithRecord({
      error,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      operationKind,
      replaySnapshotPath,
      fallbackArtifactIdentity: opts.compositeArtifactIdentity || opts.artifact?.identity,
      progressiveRollout: opts.progressiveRollout,
      replayState: {
        deployBatchId: opts.deployBatchId,
        parentRunId: opts.parentRunId,
        releaseLineageId: opts.releaseLineageId,
        artifact: opts.artifact,
        artifactLineageId: opts.artifactLineageId,
        admittedContext: opts.admittedContext,
        provisionerPlan: opts.provisionerPlan,
        deploymentMetadataFingerprint,
      },
      authority,
    });
  }
}
