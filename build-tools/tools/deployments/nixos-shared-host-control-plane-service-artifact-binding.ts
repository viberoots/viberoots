#!/usr/bin/env zx-wrapper
import {
  consumeDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "./deployment-artifact-challenges";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import {
  assertProtectedSharedArtifactIdentityFields,
  finalizedStagedArtifactReference,
} from "./nixos-shared-host-artifact-submit-request";

export async function consumeRequiredArtifactBinding(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: NixosSharedHostControlPlaneSubmitRequest;
  serviceToken?: string;
}) {
  assertProtectedSharedArtifactIdentityFields(opts.request);
  if (!opts.request.artifactDir && !opts.request.artifactDirsByComponentId) return;
  const principal = deploymentServicePrincipalForToken(opts.serviceToken);
  const proofKeyId = opts.request.artifactBindingProof?.keyId || principal.keyId;
  await consumeDeploymentArtifactChallenge({
    backend: opts.backend,
    request: opts.request,
    proof: opts.request.artifactBindingProof,
    finalizedStagedArtifactReference: finalizedStagedArtifactReference(opts.request),
    principalId: principal.principalId,
    keyId: proofKeyId,
    proofSecret: principal.proofSecret,
  });
}
