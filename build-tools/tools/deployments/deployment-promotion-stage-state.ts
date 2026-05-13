#!/usr/bin/env zx-wrapper
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract";
import {
  readBackendCurrentStageState,
  type DeploymentCurrentStageState,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";

export type DeploymentPromotionStageStateSource = {
  record: { deployRunId: string };
  artifact?: { identity: string };
  artifactIdentity?: string;
  replaySnapshot: {
    artifactIdentity?: string;
    artifact?: { identity: string };
    publishInput?:
      | { kind: "exact-artifact"; artifact?: { identity: string } }
      | {
          kind: "component-artifacts";
          components?: Array<{ artifact?: { identity?: string }; identity?: string }>;
          compositeArtifactIdentity?: string;
        };
    admittedContext: { source: { sourceRevision: string } };
    deployment: DeploymentTarget;
  };
};

function backendTarget(recordsRoot: string, databaseUrl?: string) {
  const resolved = databaseUrl || String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "");
  if (!resolved.trim()) {
    return undefined;
  }
  return { recordsRoot, databaseUrl: resolved.trim() } as NixosSharedHostControlPlaneBackendTarget;
}

function sourceStage(source: DeploymentPromotionStageStateSource): string {
  return source.replaySnapshot.deployment.environmentStage;
}

function sourceDeploymentId(source: DeploymentPromotionStageStateSource): string {
  return source.replaySnapshot.deployment.deploymentId;
}

function sourceArtifactIdentity(source: DeploymentPromotionStageStateSource): string {
  const publishInput = source.replaySnapshot.publishInput;
  const publishInputIdentity =
    publishInput?.kind === "exact-artifact"
      ? publishInput.artifact?.identity
      : publishInput?.kind === "component-artifacts" && publishInput.components?.length === 1
        ? publishInput.components[0]?.artifact?.identity || publishInput.components[0]?.identity
        : publishInput?.kind === "component-artifacts"
          ? publishInput.compositeArtifactIdentity
          : "";
  return (
    source.artifact?.identity ||
    source.replaySnapshot.artifact?.identity ||
    publishInputIdentity ||
    source.artifactIdentity ||
    source.replaySnapshot.artifactIdentity ||
    ""
  );
}

function sourceStageRevision(source: DeploymentPromotionStageStateSource): string {
  return source.replaySnapshot.admittedContext.source.sourceRevision;
}

async function readState(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deploymentId: string,
  environmentStage: string,
): Promise<DeploymentCurrentStageState | null> {
  return await readBackendCurrentStageState(backend, {
    deploymentId,
    environmentStage,
  });
}

function sourceStateErrors(
  source: DeploymentPromotionStageStateSource,
  state: DeploymentCurrentStageState | null,
): string[] {
  if (!state) {
    return [
      `source deployment current stage state is unavailable: ${sourceDeploymentId(source)}:${sourceStage(source)}`,
    ];
  }
  const errors: string[] = [];
  if (state.currentRunId !== source.record.deployRunId) {
    errors.push(
      `source run is not the current stage state for ${sourceDeploymentId(source)}:${sourceStage(source)}`,
    );
  }
  const sourceRevision = sourceStageRevision(source);
  if (state.sourceRevision !== sourceRevision) {
    errors.push(
      `source stage state revision mismatch: current=${state.sourceRevision} source=${sourceRevision}`,
    );
  }
  if (state.artifactIdentity !== sourceArtifactIdentity(source)) {
    errors.push(
      `source stage state artifact mismatch: current=${state.artifactIdentity} source=${sourceArtifactIdentity(source)}`,
    );
  }
  return errors;
}

function targetStateErrors(
  deployment: DeploymentTarget,
  state: DeploymentCurrentStageState | null,
): string[] {
  if (!state) {
    return [
      `target deployment current stage state is unavailable: ${deployment.deploymentId}:${deployment.environmentStage}`,
    ];
  }
  const errors: string[] = [];
  const targetIdentity = providerTargetIdentityFor(deployment);
  if (state.providerTargetIdentity !== targetIdentity) {
    errors.push(
      `target stage state provider target identity mismatch: current=${state.providerTargetIdentity} target=${targetIdentity}`,
    );
  }
  if (state.artifactReuseMode !== deployment.lanePolicy.artifactReuseMode) {
    errors.push(
      `target stage state artifact reuse mode mismatch: current=${state.artifactReuseMode} policy=${deployment.lanePolicy.artifactReuseMode}`,
    );
  }
  if (state.finalOutcome !== "succeeded") {
    errors.push(`target stage state is not successful: ${state.finalOutcome}`);
  }
  return errors;
}

export async function promotionStageStateErrors(opts: {
  deployment: DeploymentTarget;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  source: DeploymentPromotionStageStateSource;
}): Promise<string[]> {
  const backend = backendTarget(opts.recordsRoot, opts.backendDatabaseUrl);
  if (!backend) {
    return [
      "promotion eligibility requires backendDatabaseUrl or VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL for current stage state",
    ];
  }
  const [sourceState, targetState] = await Promise.all([
    readState(backend, sourceDeploymentId(opts.source), sourceStage(opts.source)),
    readState(backend, opts.deployment.deploymentId, opts.deployment.environmentStage),
  ]);
  return [
    ...sourceStateErrors(opts.source, sourceState),
    ...targetStateErrors(opts.deployment, targetState),
  ];
}
