#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
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
import {
  APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueAppStoreConnectControlPlaneSubmission,
  type AppStoreConnectControlPlaneSubmitRequest,
} from "./app-store-connect-control-plane";
import {
  CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueCloudflareContainersControlPlaneSubmission,
  type CloudflareContainersControlPlaneSubmitRequest,
} from "./cloudflare-containers-control-plane";
import {
  GOOGLE_PLAY_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  queueGooglePlayControlPlaneSubmission,
  type GooglePlayControlPlaneSubmitRequest,
} from "./google-play-control-plane";
import { assertNoProtectedSharedClientIdentityFields } from "./deployment-service-client-contract";

export type DeploymentProviderServiceSubmitRequest =
  | S3StaticControlPlaneSubmitRequest
  | KubernetesControlPlaneSubmitRequest
  | VercelControlPlaneSubmitRequest
  | AppStoreConnectControlPlaneSubmitRequest
  | GooglePlayControlPlaneSubmitRequest
  | CloudflareContainersControlPlaneSubmitRequest;

export function isDeploymentProviderServiceSubmitRequest(request: {
  schemaVersion?: string;
}): request is DeploymentProviderServiceSubmitRequest {
  return (
    request.schemaVersion === S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === GOOGLE_PLAY_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA ||
    request.schemaVersion === CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA
  );
}

export async function queueDeploymentProviderControlPlaneSubmission(
  request: DeploymentProviderServiceSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
    objectStore?: ControlPlaneArtifactStore;
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
      ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    });
  }
  if (request.schemaVersion === VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueVercelControlPlaneSubmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
      request,
      ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
    });
  }
  if (request.schemaVersion === APP_STORE_CONNECT_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueAppStoreConnectControlPlaneSubmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
      request,
    });
  }
  if (request.schemaVersion === GOOGLE_PLAY_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueGooglePlayControlPlaneSubmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.paths.recordsRoot,
      backend: opts.backend,
      request,
    });
  }
  if (request.schemaVersion === CLOUDFLARE_CONTAINERS_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA) {
    return await queueCloudflareContainersControlPlaneSubmission({
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
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
  });
}
