#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import {
  KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueKubernetesControlPlaneSubmission,
  type KubernetesControlPlaneSubmitRequest,
} from "./kubernetes-control-plane.ts";
import {
  S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueS3StaticControlPlaneSubmission,
  type S3StaticControlPlaneSubmitRequest,
} from "./s3-static-control-plane.ts";

export type DeploymentProviderServiceSubmitRequest =
  | S3StaticControlPlaneSubmitRequest
  | KubernetesControlPlaneSubmitRequest;

export function isDeploymentProviderServiceSubmitRequest(request: {
  schemaVersion?: string;
}): request is DeploymentProviderServiceSubmitRequest {
  return (
    request.schemaVersion === S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
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
  return request.schemaVersion === S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
    ? await queueS3StaticControlPlaneSubmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.paths.recordsRoot,
        backend: opts.backend,
        request,
      })
    : await queueKubernetesControlPlaneSubmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.paths.recordsRoot,
        backend: opts.backend,
        request,
      });
}
