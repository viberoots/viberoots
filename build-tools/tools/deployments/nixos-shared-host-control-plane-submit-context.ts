#!/usr/bin/env zx-wrapper
import type { CloudflarePagesControlPlaneSubmitRequest } from "./cloudflare-pages-control-plane-api-contract";
import type { DeploymentControlPlaneServiceInstance } from "./deployment-control-plane-contract";
import { fingerprintControlPlanePayload } from "./deployment-control-plane-idempotency";
import { resolveReviewedControlPlaneServiceInstance } from "./deployment-control-plane-service-identity";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution";
import { createServiceOwnedLaneGovernanceResolver } from "./deployment-lane-governance-service";
import type { DeploymentProviderServiceSubmitRequest } from "./deployment-provider-control-plane-submit";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";
import type { DeploymentTarget } from "./contract";

type ServiceSubmitRequest =
  | NixosSharedHostControlPlaneSubmitRequest
  | CloudflarePagesControlPlaneSubmitRequest
  | DeploymentProviderServiceSubmitRequest;

export async function resolveNixosSharedHostSubmitContext(opts: {
  request: ServiceSubmitRequest;
  resolvedRequest: { deployment: DeploymentTarget };
  workspaceRoot: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  requestFingerprint: string;
  idempotencyKey: string;
  governanceResolver: DeploymentLaneGovernanceResolver;
  serviceInstance?: DeploymentControlPlaneServiceInstance;
}> {
  return {
    requestFingerprint: fingerprintControlPlanePayload({
      ...opts.request,
      submittedAt: opts.request.submittedAt,
    }),
    idempotencyKey: opts.request.idempotencyKey || opts.request.submissionId,
    governanceResolver: createServiceOwnedLaneGovernanceResolver({
      env: opts.env,
      localFixture: opts.localFixture,
    }),
    serviceInstance: await resolveReviewedControlPlaneServiceInstance({
      schemaVersion: opts.request.schemaVersion,
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.resolvedRequest.deployment,
    }),
  };
}
