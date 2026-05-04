#!/usr/bin/env zx-wrapper
import {
  DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM,
  type DeploymentArtifactChallengeRequest,
} from "./deployment-artifact-binding";

export type DeploymentArtifactProofKeyStatus = "active" | "disabled" | "unreviewed";

export type DeploymentArtifactProofKeyRegistryEntry = {
  keyId: string;
  principalId: string;
  algorithm: typeof DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM;
  status: DeploymentArtifactProofKeyStatus;
};

export type DeploymentArtifactProofKeyRegistry = {
  keys: DeploymentArtifactProofKeyRegistryEntry[];
};

function requestedProofKeyId(request: DeploymentArtifactChallengeRequest, fallback: string) {
  return request.proofKeyId || fallback;
}

function requestedProofAlgorithm(request: DeploymentArtifactChallengeRequest) {
  return request.proofAlgorithm || DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM;
}

export function defaultDeploymentArtifactProofKeyRegistry(opts: {
  principalId: string;
  keyId: string;
}): DeploymentArtifactProofKeyRegistry {
  return {
    keys: [
      {
        principalId: opts.principalId,
        keyId: opts.keyId,
        algorithm: DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM,
        status: "active",
      },
    ],
  };
}

export function resolveDeploymentArtifactProofKey(opts: {
  request: DeploymentArtifactChallengeRequest;
  principalId: string;
  fallbackKeyId: string;
  registry?: DeploymentArtifactProofKeyRegistry;
}) {
  const keyId = requestedProofKeyId(opts.request, opts.fallbackKeyId);
  const algorithm = requestedProofAlgorithm(opts.request);
  if (algorithm !== DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM) {
    throw new Error("artifact challenge proof key uses unsupported algorithm");
  }
  const registry =
    opts.registry ||
    defaultDeploymentArtifactProofKeyRegistry({
      principalId: opts.principalId,
      keyId: opts.fallbackKeyId,
    });
  return assertDeploymentArtifactProofKeyActive({
    registry,
    keyId,
    principalId: opts.principalId,
  });
}

export function assertDeploymentArtifactProofKeyActive(opts: {
  registry: DeploymentArtifactProofKeyRegistry;
  keyId: string;
  principalId: string;
}) {
  const entry = opts.registry.keys.find((key) => key.keyId === opts.keyId);
  if (!entry) throw new Error("artifact challenge proof key is unknown");
  if (entry.status === "disabled") throw new Error("artifact challenge proof key is disabled");
  if (entry.status === "unreviewed") throw new Error("artifact challenge proof key is unreviewed");
  if (entry.principalId !== opts.principalId) {
    throw new Error("artifact challenge proof key is not assigned to the authenticated principal");
  }
  if (entry.algorithm !== DEPLOYMENT_ARTIFACT_BINDING_ALGORITHM) {
    throw new Error("artifact challenge proof key algorithm mismatch");
  }
  return entry;
}
