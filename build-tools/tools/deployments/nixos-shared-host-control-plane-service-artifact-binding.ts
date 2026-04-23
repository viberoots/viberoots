#!/usr/bin/env zx-wrapper
import {
  consumeDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "./deployment-artifact-challenges.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";

export async function consumeRequiredArtifactBinding(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: NixosSharedHostControlPlaneSubmitRequest;
  serviceToken?: string;
}) {
  if (!opts.request.artifactDir && !opts.request.artifactDirsByComponentId) return;
  if (!opts.request.expectedArtifactIdentity && !opts.request.expectedComponentArtifactIdentities) {
    throw new Error("protected/shared artifact submit requires expected artifact identity");
  }
  const principal = deploymentServicePrincipalForToken(opts.serviceToken);
  await consumeDeploymentArtifactChallenge({
    backend: opts.backend,
    request: opts.request,
    proof: opts.request.artifactBindingProof,
    finalizedStagedArtifactReference:
      opts.request.artifactDir || JSON.stringify(opts.request.artifactDirsByComponentId),
    principalId: principal.principalId,
    keyId: principal.keyId,
    proofSecret: principal.proofSecret,
  });
}
