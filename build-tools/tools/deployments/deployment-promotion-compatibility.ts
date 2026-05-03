#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { edgeAllowsCrossProviderPromotion } from "./deployment-lane-promotion-compatibility.ts";
import {
  componentIds,
  componentKinds,
  componentRuntimeContracts,
  componentTargets,
  mobilePromotionCompatibilityErrors,
  promotionCompatibilityFamily,
  provisionerTypeFor,
  rolloutSignature,
} from "./deployment-promotion-contract.ts";
import { opentofuPromotionCompatibilityErrors } from "./opentofu-stack.ts";

type PromotionSourceLike = {
  record: { finalOutcome?: string; publishMode?: string; deploymentId: string };
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

function sourceStage(source: PromotionSourceLike): string {
  return source.replaySnapshot.deployment.environmentStage;
}

function sourceArtifactIdentity(source: PromotionSourceLike): string {
  return source.replaySnapshot.artifactIdentity || source.replaySnapshot.artifact?.identity || "";
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
  const crossProviderAllowed = edgeAllowsCrossProviderPromotion(
    deployment.lanePolicy.promotionCompatibility,
    edge,
  );
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
  if (!crossProviderAllowed && sourceDeployment.provider !== deployment.provider) {
    errors.push(
      `provider mismatch: current=${deployment.provider} source=${sourceDeployment.provider}`,
    );
  }
  if (!crossProviderAllowed && sourceDeployment.publisher.type !== deployment.publisher.type) {
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
  if (crossProviderAllowed) {
    const sourceFamily = promotionCompatibilityFamily(sourceDeployment);
    const targetFamily = promotionCompatibilityFamily(deployment);
    if (!sourceFamily || !targetFamily) {
      errors.push(
        `reviewed cross-provider promotion is unsupported for ${sourceDeployment.provider} -> ${deployment.provider}`,
      );
    } else if (sourceFamily !== targetFamily) {
      errors.push(
        `promotion compatibility family mismatch: current=${targetFamily} source=${sourceFamily}`,
      );
    }
  } else {
    errors.push(...mobilePromotionCompatibilityErrors(deployment, sourceDeployment));
    const sourceProvisioner = provisionerTypeFor(sourceDeployment);
    const targetProvisioner = provisionerTypeFor(deployment);
    if (sourceProvisioner !== targetProvisioner) {
      errors.push(
        `provisioner mismatch: current=${targetProvisioner || "<none>"} source=${sourceProvisioner || "<none>"}`,
      );
    }
    errors.push(...opentofuPromotionCompatibilityErrors(deployment, sourceDeployment));
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
