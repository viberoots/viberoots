#!/usr/bin/env zx-wrapper
import { resolveCloudflarePagesArtifactInput } from "./cloudflare-pages-artifact-input";
import type { ResolvedCloudflarePagesServiceSubmitRequest } from "./cloudflare-pages-control-plane-service-submit";
import { workerSecretRuntimeMetadata } from "./deployment-secret-worker-runtime-metadata";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

export function secretRuntimeForCloudflareDeployment(
  deployment: ResolvedCloudflarePagesServiceSubmitRequest["request"]["deployment"],
) {
  return workerSecretRuntimeMetadata({ deployment });
}

export async function resolveCloudflarePagesArtifactForSubmission(
  resolved: Extract<ResolvedCloudflarePagesServiceSubmitRequest, { kind: "deploy" | "promotion" }>,
  opts: {
    workspaceRoot: string;
    recordsRoot: string;
    backend?: NixosSharedHostControlPlaneBackendTarget;
    objectStore?: ControlPlaneArtifactStore;
  },
) {
  return await resolveCloudflarePagesArtifactInput({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    ...(opts.backend ? { backend: opts.backend } : {}),
    deployment: resolved.request.deployment,
    submissionId: resolved.request.submissionId,
    artifactInput: resolved.artifactInput!,
    ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
  });
}
