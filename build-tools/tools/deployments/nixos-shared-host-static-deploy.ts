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
import {
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan.ts";
import { writeNixosSharedHostProvisionOnlyRecord } from "./nixos-shared-host-provision-record.ts";
import { createNixosSharedHostReleasePhaseRunner } from "./nixos-shared-host-release-phase.ts";
import { writeNixosSharedHostReplayComponentResults } from "./nixos-shared-host-replay.ts";
import {
  materializeNixosSharedHostRuntimeWithSecrets,
  runNixosSharedHostReleasePhaseWithSecrets,
  smokeNixosSharedHostPublishedComponentsWithSecrets,
} from "./nixos-shared-host-secret-runtime.ts";
import { prepareNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy-setup.ts";
import {
  failNixosSharedHostStaticDeploy,
  writeSuccessfulNixosSharedHostStaticDeployRecord,
} from "./nixos-shared-host-static-deploy-failure.ts";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers.ts";
import { runStaticDeployProgressivePhases } from "./nixos-shared-host-static-deploy-progressive.ts";

type StaticOperationKind = "deploy" | "promotion" | "provision_only" | "retry" | "rollback";
type StaticPublishBehavior = "deploy" | "publish-only" | "provision-only";

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
  let deploymentMetadataFingerprint: string | undefined, replaySnapshotPath: string | undefined;
  const baseReplayState = {
    deployBatchId: opts.deployBatchId,
    parentRunId: opts.parentRunId,
    releaseLineageId: opts.releaseLineageId,
    artifact: opts.artifact,
    artifactLineageId: opts.artifactLineageId,
    admittedContext: opts.admittedContext,
    provisionerPlan: opts.provisionerPlan,
  };
  let replayState = { ...baseReplayState, deploymentMetadataFingerprint };
  const secretRuntime = createVaultDeploymentSecretRuntime({
    authority,
    admittedContext: opts.admittedContext,
    fallbackTargetScope: authority.kind,
  });
  try {
    const runReleasePhase = createNixosSharedHostReleasePhaseRunner({
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      deployment: opts.deployment,
      operationKind,
      releaseActions,
    });
    const prepared = await prepareNixosSharedHostStaticDeploy({
      deployment: opts.deployment,
      statePath: opts.statePath,
      hostConfigPath: opts.hostConfigPath,
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      publishBehavior,
      authority,
      artifact: opts.artifact,
      componentArtifacts: opts.componentArtifacts,
      compositeArtifactIdentity: opts.compositeArtifactIdentity,
      admittedContext: opts.admittedContext!,
      ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
      provisionerPlan: opts.provisionerPlan,
    });
    const {
      componentArtifacts,
      topLevelArtifactIdentity,
      rendered,
      deploymentMetadataFingerprint: preparedDeploymentMetadataFingerprint,
      replaySnapshotPath: preparedReplaySnapshotPath,
    } = prepared;
    deploymentMetadataFingerprint = preparedDeploymentMetadataFingerprint;
    replaySnapshotPath = preparedReplaySnapshotPath;
    replayState = { ...baseReplayState, deploymentMetadataFingerprint };
    if (publishBehavior === "provision-only") {
      await materializeNixosSharedHostRuntimeWithSecrets(secretRuntime, opts.hostRoot, rendered);
      return await writeNixosSharedHostProvisionOnlyRecord({
        deployment: opts.deployment,
        recordsRoot: opts.recordsRoot,
        deployRunId: runId,
        operationKind: "provision_only",
        authority,
        artifactIdentity: topLevelArtifactIdentity,
        replaySnapshotPath,
        ...replayState,
      });
    }
    if (publishBehavior === "deploy") {
      await materializeNixosSharedHostRuntimeWithSecrets(secretRuntime, opts.hostRoot, rendered);
    }
    for (const componentArtifact of componentArtifacts) {
      await requireNixosSharedHostAdmittedArtifactPath(componentArtifact.artifact);
    }
    await runNixosSharedHostReleasePhaseWithSecrets(
      secretRuntime,
      runReleasePhase,
      operationKind,
      releaseActions,
      "pre_publish",
      {
        artifactIdentity: topLevelArtifactIdentity,
      },
    );
    await secretRuntime.enterStep("publish");
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
        artifactIdentity: topLevelArtifactIdentity,
        replaySnapshotPath,
        ...replayState,
      },
      authority,
    });
    await runNixosSharedHostReleasePhaseWithSecrets(
      secretRuntime,
      runReleasePhase,
      operationKind,
      releaseActions,
      "post_publish_pre_smoke",
      {
        artifactIdentity: topLevelArtifactIdentity,
      },
    );
    const smoke = progressive.smoke
      ? progressive.smoke
      : await smokeNixosSharedHostPublishedComponentsWithSecrets({
          secretRuntime,
          deployment: opts.deployment,
          published: progressive.published,
          ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
        });
    await runNixosSharedHostReleasePhaseWithSecrets(
      secretRuntime,
      runReleasePhase,
      operationKind,
      releaseActions,
      "post_smoke",
      {
        artifactIdentity: topLevelArtifactIdentity,
        publicUrl: smoke.publicUrl,
      },
    );
    if (replaySnapshotPath && smoke.componentResults.length > 0)
      await writeNixosSharedHostReplayComponentResults(
        replaySnapshotPath,
        smoke.componentResults,
        progressive?.rollout || opts.progressiveRollout,
      );
    const smokeOutcome = "smokeOutcome" in smoke ? smoke.smokeOutcome : "passed";
    const smokeException = "smokeException" in smoke ? smoke.smokeException : undefined;
    const smokeError = "smokeError" in smoke ? smoke.smokeError : undefined;
    return await writeSuccessfulNixosSharedHostStaticDeployRecord({
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      operationKind,
      authority,
      artifactIdentity: topLevelArtifactIdentity,
      replaySnapshotPath,
      ...replayState,
      progressiveRollout: progressive.progressiveRollout || opts.progressiveRollout,
      smokeOutcome,
      ...(smokeException ? { smokeException } : {}),
      ...(smokeError ? { smokeError } : {}),
      componentResults: smoke.componentResults,
      publicUrl: smoke.publicUrl,
      healthUrl: smoke.healthUrl,
    });
  } catch (error) {
    if ((error as any)?.paused || (error as any)?.recordPath) throw error;
    await failNixosSharedHostStaticDeploy({
      error,
      deployment: opts.deployment,
      recordsRoot: opts.recordsRoot,
      deployRunId: runId,
      operationKind,
      replaySnapshotPath,
      fallbackArtifactIdentity: opts.compositeArtifactIdentity || opts.artifact?.identity,
      progressiveRollout: opts.progressiveRollout,
      replayState,
      authority,
    });
  }
}
