#!/usr/bin/env zx-wrapper
import {
  createDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "./deployment-artifact-challenges.ts";
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz.ts";
import { resolveSubmitAuthorizationBoundary } from "./deployment-service-authorization-boundary.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";

export async function handleControlPlaneArtifactChallenge(
  request: NixosSharedHostControlPlaneSubmitRequest,
  opts: {
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
    serviceToken?: string;
  },
) {
  const boundary = await resolveSubmitAuthorizationBoundary({
    recordsRoot: opts.paths.recordsRoot,
    deployment: request.deployment,
    operationKind: request.operationKind,
    authSessionId: request.authSessionId,
    request,
    authorization: request.authorization,
    requestedBy: request.requestedBy,
    admissionEvidence: request.admissionEvidence,
    consumeAuthSession: false,
  });
  const authorization = boundary.authorization
    ? authorizeControlPlaneSubmit({
        deployment: request.deployment,
        operationKind: request.operationKind,
        authorization: boundary.authorization,
      })
    : undefined;
  const principal = deploymentServicePrincipalForToken(opts.serviceToken);
  return await createDeploymentArtifactChallenge({
    backend: opts.backend,
    request,
    principalId: principal.principalId,
    keyId: principal.keyId,
    ...(authorization ? { authorization } : {}),
  });
}
