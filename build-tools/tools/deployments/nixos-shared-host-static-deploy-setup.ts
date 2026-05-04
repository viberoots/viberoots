#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import { primaryNixosSharedHostComponent } from "./nixos-shared-host-components";
import { withFailedStep } from "./nixos-shared-host-deploy-failure";
import { readNixosSharedHostPlatformStateOrEmpty, writeJsonDocument } from "./nixos-shared-host-io";
import { applyNixosSharedHostScopedDeployments } from "./nixos-shared-host-platform";
import { captureStaticDeployReplaySnapshot } from "./nixos-shared-host-static-deploy-records";
import { renderNixosSharedHostConfig } from "./nixos-shared-host";

export async function prepareNixosSharedHostStaticDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  statePath: string;
  hostConfigPath?: string;
  recordsRoot: string;
  deployRunId: string;
  publishBehavior: "deploy" | "publish-only" | "provision-only";
  authority: { lockScope: string; executionSnapshotPath: string };
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity?: string;
  admittedContext: NixosSharedHostAdmittedContext;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
}) {
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
    opts.publishBehavior === "publish-only"
      ? current
      : applyNixosSharedHostScopedDeployments(current, [opts.deployment]);
  if (opts.publishBehavior !== "publish-only") await writeJsonDocument(opts.statePath, state);
  const rendered = renderNixosSharedHostConfig(state);
  if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
  if (opts.publishBehavior === "publish-only" && Object.keys(rendered.containers).length === 0) {
    throw withFailedStep(
      "publish",
      new Error(`publish-only requires an existing realized target: ${opts.authority.lockScope}`),
    );
  }
  const { deploymentMetadataFingerprint, replaySnapshotPath } =
    await captureStaticDeployReplaySnapshot({
      recordsRoot: opts.recordsRoot,
      deployRunId: opts.deployRunId,
      deployment: opts.deployment,
      artifact: opts.artifact,
      componentArtifacts,
      compositeArtifactIdentity: opts.compositeArtifactIdentity,
      admittedContext: opts.admittedContext,
      platformState: state,
      hostConfig: rendered,
      ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
      provisionerPlan: opts.provisionerPlan,
      controlPlaneExecutionSnapshotPath: opts.authority.executionSnapshotPath,
    });
  return {
    componentArtifacts,
    topLevelArtifactIdentity,
    state,
    rendered,
    deploymentMetadataFingerprint,
    replaySnapshotPath,
  };
}
