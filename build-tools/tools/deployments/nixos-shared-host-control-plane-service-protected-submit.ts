#!/usr/bin/env zx-wrapper
import { authorizeControlPlaneSubmit } from "./deployment-control-plane-authz.ts";
import { resolveSubmitAuthorizationBoundary } from "./deployment-service-authorization-boundary.ts";
import { acceptChallengedNixosSharedHostSubmit } from "./nixos-shared-host-control-plane-challenged-submit.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import { cleanupThenRethrowRejectedNixosSubmit } from "./nixos-shared-host-control-plane-rejection-cleanup.ts";
import { assertReviewedServiceBearerToken } from "./nixos-shared-host-control-plane-service-auth.ts";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution.ts";

export async function handleProtectedChallengedNixosServiceSubmit(opts: {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backend: NixosSharedHostControlPlaneBackendTarget;
  serviceToken?: string;
  authorizationHeader?: string | string[];
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  request: NixosSharedHostControlPlaneSubmitRequest;
  resolvedRequest: NixosSharedHostControlPlaneSubmitRequest;
  requestFingerprint: string;
  idempotencyKey: string;
  governanceResolver?: DeploymentLaneGovernanceResolver;
}) {
  try {
    assertReviewedServiceBearerToken({
      authorizationHeader: opts.authorizationHeader,
      serviceToken: opts.serviceToken,
      localFixture: opts.localFixture,
      env: opts.env,
    });
    const boundary = await resolveSubmitAuthorizationBoundary({
      recordsRoot: opts.paths.recordsRoot,
      deployment: opts.resolvedRequest.deployment,
      operationKind: opts.resolvedRequest.operationKind,
      authSessionId: opts.request.authSessionId,
      request: opts.request,
      authorization: opts.resolvedRequest.authorization,
      requestedBy: opts.resolvedRequest.requestedBy,
      admissionEvidence: opts.resolvedRequest.admissionEvidence,
    });
    const authorization = boundary.authorization
      ? authorizeControlPlaneSubmit({
          deployment: opts.resolvedRequest.deployment,
          operationKind: opts.resolvedRequest.operationKind,
          authorization: boundary.authorization,
        })
      : undefined;
    return await acceptChallengedNixosSharedHostSubmit({
      workspaceRoot: opts.workspaceRoot,
      paths: opts.paths,
      backend: opts.backend,
      serviceToken: opts.serviceToken,
      resolvedRequest: opts.resolvedRequest,
      requestFingerprint: opts.requestFingerprint,
      idempotencyKey: opts.idempotencyKey,
      boundary,
      ...(opts.governanceResolver ? { governanceResolver: opts.governanceResolver } : {}),
      ...(authorization ? { authorization } : {}),
    });
  } catch (error) {
    return await cleanupThenRethrowRejectedNixosSubmit({
      error,
      request: opts.resolvedRequest,
      paths: opts.paths,
      backend: opts.backend,
      reason: "submit_rejected",
    });
  }
}
