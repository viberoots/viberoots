#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostAdmittedContext } from "./nixos-shared-host-admission";
import type { NixosSharedHostDeployment } from "./contract";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostProvisionerPlanRef } from "./nixos-shared-host-provisioner-plan";
import { writeNixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay";

export function artifactOutcomeFields(opts: {
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  artifactLineageId?: string;
}) {
  return {
    ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
    ...(opts.artifact?.storedArtifactPath
      ? { artifactStoredArtifactPath: opts.artifact.storedArtifactPath }
      : {}),
    ...(opts.artifact?.provenancePath
      ? { artifactProvenancePath: opts.artifact.provenancePath }
      : {}),
    ...(opts.artifactLineageId || opts.artifactIdentity
      ? { artifactLineageId: opts.artifactLineageId || opts.artifactIdentity }
      : {}),
  };
}

export function staticDeployRecordFields(opts: {
  deployBatchId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  artifactLineageId?: string;
  admittedContext?: NixosSharedHostAdmittedContext;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  deploymentMetadataFingerprint?: string;
  replaySnapshotPath?: string;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
}) {
  return {
    ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
    ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}),
    ...(opts.releaseLineageId ? { releaseLineageId: opts.releaseLineageId } : {}),
    ...artifactOutcomeFields(opts),
    ...(opts.admittedContext ? { admittedContext: opts.admittedContext } : {}),
    ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
    ...(opts.deploymentMetadataFingerprint
      ? { deploymentMetadataFingerprint: opts.deploymentMetadataFingerprint }
      : {}),
    ...(opts.replaySnapshotPath ? { replaySnapshotPath: opts.replaySnapshotPath } : {}),
    ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
  };
}

export async function captureStaticDeployReplaySnapshot(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: NixosSharedHostDeployment;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity?: string;
  admittedContext: NixosSharedHostAdmittedContext;
  platformState: unknown;
  hostConfig: unknown;
  provisionerPlan?: NixosSharedHostProvisionerPlanRef;
  controlPlaneExecutionSnapshotPath: string;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
}) {
  if (!opts.artifact && opts.componentArtifacts.length === 0) return {};
  return await writeNixosSharedHostReplaySnapshot({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.deployRunId,
    deployment: opts.deployment,
    ...(opts.artifact ? { artifact: opts.artifact } : {}),
    ...(opts.componentArtifacts.length > 0 ? { componentArtifacts: opts.componentArtifacts } : {}),
    ...(opts.compositeArtifactIdentity
      ? { compositeArtifactIdentity: opts.compositeArtifactIdentity }
      : {}),
    admittedContext: opts.admittedContext,
    platformState: opts.platformState,
    hostConfig: opts.hostConfig,
    ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
    ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
    controlPlaneExecutionSnapshotPath: opts.controlPlaneExecutionSnapshotPath,
  });
}
