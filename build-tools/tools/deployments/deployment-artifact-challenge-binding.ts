#!/usr/bin/env zx-wrapper
import {
  artifactBindingFingerprint,
  baseArtifactChallengeRequest,
  type DeploymentArtifactChallengeRequest,
} from "./deployment-artifact-binding";
import { DeploymentUnauthorizedError } from "./deployment-control-plane-errors";
import type {
  DeploymentControlPlaneAuthorizationDecision,
  DeploymentControlPlaneScope,
} from "./deployment-control-plane-contract";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components";

export type DeploymentArtifactAuthorizationBinding = {
  principalId: string;
  role: string;
  scope: DeploymentControlPlaneScope;
};

export type DeploymentArtifactChallengeBinding = {
  request: DeploymentArtifactChallengeRequest;
  providerTargetIdentity: string;
  lockScope: string;
  finalizedStagedArtifactReference?: string;
  authorization?: DeploymentArtifactAuthorizationBinding;
};

function authorizationBinding(
  decision?: DeploymentControlPlaneAuthorizationDecision,
): DeploymentArtifactAuthorizationBinding | undefined {
  if (!decision) return undefined;
  return {
    principalId: decision.principal.principalId,
    role: decision.role,
    scope: decision.scope,
  };
}

export function artifactChallengeBinding(opts: {
  request: DeploymentArtifactChallengeRequest;
  finalizedStagedArtifactReference?: string;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
}): DeploymentArtifactChallengeBinding {
  const providerTargetIdentity = nixosSharedHostDeploymentTargetIdentity(opts.request.deployment);
  return {
    request: baseArtifactChallengeRequest(opts.request),
    providerTargetIdentity,
    lockScope: providerTargetIdentity,
    ...(opts.finalizedStagedArtifactReference
      ? { finalizedStagedArtifactReference: opts.finalizedStagedArtifactReference }
      : {}),
    ...(authorizationBinding(opts.authorization)
      ? { authorization: authorizationBinding(opts.authorization) }
      : {}),
  };
}

export function decodeArtifactChallengeBinding(value: unknown): DeploymentArtifactChallengeBinding {
  const candidate = value as Partial<DeploymentArtifactChallengeBinding> | undefined;
  if (candidate?.request && candidate.providerTargetIdentity && candidate.lockScope) {
    return candidate as DeploymentArtifactChallengeBinding;
  }
  return artifactChallengeBinding({ request: value as DeploymentArtifactChallengeRequest });
}

export function assertArtifactChallengeBindingMatches(opts: {
  stored: DeploymentArtifactChallengeBinding;
  request: DeploymentArtifactChallengeRequest;
  finalizedStagedArtifactReference?: string;
  authorization?: DeploymentControlPlaneAuthorizationDecision;
}) {
  const expected = artifactChallengeBinding({
    request: opts.request,
    ...(opts.finalizedStagedArtifactReference
      ? { finalizedStagedArtifactReference: opts.finalizedStagedArtifactReference }
      : {}),
    ...(opts.authorization ? { authorization: opts.authorization } : {}),
  });
  if (
    artifactBindingFingerprint(opts.stored.request) !== artifactBindingFingerprint(expected.request)
  ) {
    throw new Error("artifact submission challenge does not match this request");
  }
  if (
    opts.stored.providerTargetIdentity !== expected.providerTargetIdentity ||
    opts.stored.lockScope !== expected.lockScope
  ) {
    throw new Error("artifact submission challenge target binding mismatch");
  }
  if (
    (opts.stored.finalizedStagedArtifactReference || null) !==
    (expected.finalizedStagedArtifactReference || null)
  ) {
    throw new Error("artifact submission challenge staged-reference binding mismatch");
  }
  if (
    artifactBindingFingerprint(opts.stored.authorization || null) !==
    artifactBindingFingerprint(expected.authorization || null)
  ) {
    throw new DeploymentUnauthorizedError(
      "artifact submission challenge authorization binding mismatch",
    );
  }
}
