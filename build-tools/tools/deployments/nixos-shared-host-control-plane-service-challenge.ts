#!/usr/bin/env zx-wrapper
import {
  createDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "./deployment-artifact-challenges";
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz";
import { resolveSubmitAuthorizationBoundary } from "./deployment-service-authorization-boundary";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import {
  assertProtectedSharedArtifactIdentityFields,
  finalizedStagedArtifactReference,
} from "./nixos-shared-host-artifact-submit-request";
import { cleanupThenRethrowRejectedNixosSubmit } from "./nixos-shared-host-control-plane-rejection-cleanup";
import { assertReviewedServiceBearerToken } from "./nixos-shared-host-control-plane-service-auth";

export async function handleControlPlaneArtifactChallenge(
  request: NixosSharedHostControlPlaneSubmitRequest,
  opts: {
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
    serviceToken?: string;
    authorizationHeader?: string | string[];
    localFixture?: boolean;
    env?: NodeJS.ProcessEnv;
  },
) {
  try {
    assertReviewedServiceBearerToken({
      authorizationHeader: opts.authorizationHeader,
      serviceToken: opts.serviceToken,
      localFixture: opts.localFixture,
      env: opts.env,
    });
    assertProtectedSharedArtifactIdentityFields(request);
    const boundary = await resolveSubmitAuthorizationBoundary({
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
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
      finalizedStagedArtifactReference: finalizedStagedArtifactReference(request),
      ...(authorization ? { authorization } : {}),
    });
  } catch (error) {
    return await cleanupThenRethrowRejectedNixosSubmit({
      error,
      request,
      paths: opts.paths,
      backend: opts.backend,
      reason: "challenge_rejected",
    });
  }
}
