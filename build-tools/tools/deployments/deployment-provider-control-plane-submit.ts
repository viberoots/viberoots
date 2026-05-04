#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import {
  KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueKubernetesControlPlaneSubmission,
  type KubernetesControlPlaneSubmitRequest,
} from "./kubernetes-control-plane";
import {
  S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueS3StaticControlPlaneSubmission,
  type S3StaticControlPlaneSubmitRequest,
} from "./s3-static-control-plane";
import {
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueVercelControlPlaneSubmission,
  type VercelControlPlaneSubmitRequest,
} from "./vercel-control-plane";
import { assertNoProtectedSharedClientIdentityFields } from "./deployment-service-client-contract";

export type DeploymentProviderServiceSubmitRequest =
  | S3StaticControlPlaneSubmitRequest
  | KubernetesControlPlaneSubmitRequest
  | VercelControlPlaneSubmitRequest;

export function isDeploymentProviderServiceSubmitRequest(request: {
  schemaVersion?: string;
}): request is DeploymentProviderServiceSubmitRequest {
  return (
    request.schemaVersion === S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
  );
}

export async function queueDeploymentProviderControlPlaneSubmission(
  request: DeploymentProviderServiceSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
  },
) {
  assertNoProtectedSharedClientIdentityFields({
    deployment: request.deployment,
    request,
  });
  if (request.schemaVersion === S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueS3StaticControlPlaneSubmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
      request,
    });
  }
  if (request.schemaVersion === VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueVercelControlPlaneSubmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
      request,
    });
  }
  return await queueKubernetesControlPlaneSubmission({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.paths.recordsRoot,
    backend: opts.backend,
    request,
  });
}
