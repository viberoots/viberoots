#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";

type PromotionSourceLike = {
  record: {
    finalOutcome?: string;
    publishMode?: string;
    deploymentId: string;
  };
  replaySnapshot: {
    artifactIdentity?: string;
    artifact?: { identity: string };
    admittedContext: {
      lanePolicyFingerprint: string;
      source: { sourceRevision: string };
    };
    deployment: DeploymentTarget;
  };
};

function rolloutSignature(deployment: DeploymentTarget): string {
  return JSON.stringify(deployment.rolloutPolicy || null);
}

function appStoreTrackRank(track: string): number {
  return (
    {
      "testflight-internal": 0,
      "testflight-external": 1,
      "app-store": 2,
    }[track] ?? -1
  );
}

function mobilePromotionCompatibilityErrors(
  deployment: DeploymentTarget,
  sourceDeployment: DeploymentTarget,
): string[] {
  if (deployment.provider !== sourceDeployment.provider) {
    return [];
  }
  if (!["app-store-connect", "google-play"].includes(deployment.provider)) {
    return [];
  }
  const errors: string[] = [];
  if (deployment.providerTarget.signingModel !== sourceDeployment.providerTarget.signingModel) {
    errors.push(
      `signing model mismatch: current=${deployment.providerTarget.signingModel} source=${sourceDeployment.providerTarget.signingModel}`,
    );
  }
  const trackRank = (track: string) =>
    deployment.provider === "google-play"
      ? ({ internal: 0, alpha: 1, beta: 2, production: 3 }[track] ?? -1)
      : appStoreTrackRank(track);
  const sourceTrackRank = trackRank(sourceDeployment.providerTarget.track);
  const targetTrackRank = trackRank(deployment.providerTarget.track);
  if (sourceTrackRank < 0 || targetTrackRank < 0 || targetTrackRank < sourceTrackRank) {
    errors.push(
      `mobile track progression mismatch: current=${deployment.providerTarget.track} source=${sourceDeployment.providerTarget.track}`,
    );
  }
  const rolloutRank = (mode: string) =>
    mode === "store_staged" ? 1 : mode === "all_at_once" ? 0 : -1;
  const sourceRollout = sourceDeployment.rolloutPolicy?.mode || "all_at_once";
  const targetRollout = deployment.rolloutPolicy?.mode || "all_at_once";
  if (rolloutRank(sourceRollout) < 0 || rolloutRank(targetRollout) < rolloutRank(sourceRollout)) {
    errors.push(
      `mobile rollout progression mismatch: current=${targetRollout} source=${sourceRollout}`,
    );
  }
  return errors;
}

function componentIds(deployment: DeploymentTarget): string {
  return deployment.components
    .map((component) => component.id)
    .sort()
    .join(",");
}

function componentKinds(deployment: DeploymentTarget): string {
  return deployment.components
    .map((component) => component.kind)
    .sort()
    .join(",");
}

function componentTargets(deployment: DeploymentTarget): string {
  return deployment.components
    .map((component) => component.target)
    .sort()
    .join(",");
}

function componentRuntimeContracts(deployment: DeploymentTarget): string {
  if (deployment.provider !== "nixos-shared-host") return "";
  return deployment.components
    .map((component) =>
      JSON.stringify({
        id: component.id,
        kind: component.kind,
        runtimeContract:
          "runtimeContract" in component.runtime ? component.runtime.runtimeContract : null,
      }),
    )
    .sort()
    .join(",");
}

function sourceStage(source: PromotionSourceLike): string {
  return source.replaySnapshot.deployment.environmentStage;
}

function sourceArtifactIdentity(source: PromotionSourceLike): string {
  return source.replaySnapshot.artifactIdentity || source.replaySnapshot.artifact?.identity || "";
}

function provisionerTypeFor(deployment: DeploymentTarget): string {
  return "provisioner" in deployment ? deployment.provisioner?.type || "" : "";
}

export function sourcePromotionRevision(source: PromotionSourceLike): string {
  return source.replaySnapshot.admittedContext.source.sourceRevision;
}

export function promotionCompatibilityErrors(
  deployment: DeploymentTarget,
  source: PromotionSourceLike,
): string[] {
  const sourceDeployment = source.replaySnapshot.deployment;
  const errors: string[] = [];
  if (source.record.finalOutcome !== "succeeded") {
    errors.push(`source run is not successful: ${source.record.finalOutcome}`);
  }
  if (source.record.publishMode !== "normal") {
    errors.push(`promotion source must use publish_mode normal, got ${source.record.publishMode}`);
  }
  if (source.record.deploymentId === deployment.deploymentId) {
    errors.push(`promotion requires a distinct target deployment id: ${deployment.deploymentId}`);
  }
  if (sourceDeployment.provider !== deployment.provider) {
    errors.push(
      `provider mismatch: current=${deployment.provider} source=${sourceDeployment.provider}`,
    );
  }
  if (sourceDeployment.lanePolicyRef !== deployment.lanePolicyRef) {
    errors.push(
      `lanePolicyRef mismatch: current=${deployment.lanePolicyRef} source=${sourceDeployment.lanePolicyRef}`,
    );
  }
  if (
    source.replaySnapshot.admittedContext.lanePolicyFingerprint !==
    deployment.lanePolicy.fingerprint
  ) {
    errors.push(
      `lanePolicyFingerprint mismatch: current=${deployment.lanePolicy.fingerprint} source=${source.replaySnapshot.admittedContext.lanePolicyFingerprint}`,
    );
  }
  const edge = `${sourceStage(source)}->${deployment.environmentStage}`;
  if (!deployment.lanePolicy.allowedPromotionEdges.includes(edge)) {
    errors.push(`promotion edge is not allowed by the current lane policy: ${edge}`);
  }
  if (componentIds(sourceDeployment) !== componentIds(deployment)) {
    errors.push(
      `component id mismatch: current=${componentIds(deployment)} source=${componentIds(sourceDeployment)}`,
    );
  }
  if (componentKinds(sourceDeployment) !== componentKinds(deployment)) {
    errors.push(
      `component kind mismatch: current=${componentKinds(deployment)} source=${componentKinds(sourceDeployment)}`,
    );
  }
  if (componentTargets(sourceDeployment) !== componentTargets(deployment)) {
    errors.push(
      `component target mismatch: current=${componentTargets(deployment)} source=${componentTargets(sourceDeployment)}`,
    );
  }
  if (sourceDeployment.publisher.type !== deployment.publisher.type) {
    errors.push(
      `publisher type mismatch: current=${deployment.publisher.type} source=${sourceDeployment.publisher.type}`,
    );
  }
  if (componentRuntimeContracts(sourceDeployment) !== componentRuntimeContracts(deployment)) {
    errors.push("runtime contract mismatch between source and target deployment");
  }
  if (
    !["app-store-connect", "google-play"].includes(deployment.provider) &&
    rolloutSignature(sourceDeployment) !== rolloutSignature(deployment)
  ) {
    errors.push("rollout semantics mismatch between source and target deployment");
  }
  errors.push(...mobilePromotionCompatibilityErrors(deployment, sourceDeployment));
  const sourceProvisioner = provisionerTypeFor(sourceDeployment);
  const targetProvisioner = provisionerTypeFor(deployment);
  if (sourceProvisioner !== targetProvisioner) {
    errors.push(
      `provisioner mismatch: current=${targetProvisioner || "<none>"} source=${sourceProvisioner || "<none>"}`,
    );
  }
  if (
    deployment.lanePolicy.artifactReuseMode === "same_artifact" &&
    sourceArtifactIdentity(source).trim() === ""
  ) {
    errors.push("same_artifact promotion requires a reusable exact artifact identity");
  }
  return errors;
}

export function exactArtifactPromotionErrors(deployment: DeploymentTarget): string[] {
  return deployment.lanePolicy.artifactReuseMode === "same_artifact"
    ? []
    : [
        `target lane artifact_reuse_mode ${deployment.lanePolicy.artifactReuseMode} requires target-stage rebuild; use a non-publish-only promotion flow`,
      ];
}
