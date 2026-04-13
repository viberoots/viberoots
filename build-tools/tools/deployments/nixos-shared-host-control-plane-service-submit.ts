#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import { resolveNixosSharedHostPublishOnlySubmission } from "./nixos-shared-host-publish-only.ts";
import { resolveNixosSharedHostProvisionOnlySubmission } from "./nixos-shared-host-provision-only.ts";

export async function resolveServiceSubmitRequest(
  request: NixosSharedHostControlPlaneSubmitRequest,
  opts: {
    workspaceRoot: string;
    paths: NixosSharedHostControlPlanePaths;
    backend: NixosSharedHostControlPlaneBackendTarget;
  },
): Promise<NixosSharedHostControlPlaneSubmitRequest> {
  if (request.publishBehavior === "publish-only") {
    const resolved = await resolveNixosSharedHostPublishOnlySubmission({
      workspaceRoot: opts.workspaceRoot,
      deployment: request.deployment,
      paths: opts.paths,
      sourceRunId: String(request.sourceRunId || "").trim(),
      rollback: Boolean(request.rollback),
      backendDatabaseUrl: opts.backend.databaseUrl,
    });
    return {
      ...request,
      operationKind: resolved.operationKind,
      deployment: resolved.deployment,
      ...(resolved.artifact ? { artifact: resolved.artifact } : {}),
      ...(resolved.componentArtifacts ? { componentArtifacts: resolved.componentArtifacts } : {}),
      parentRunId: resolved.parentRunId,
      ...(resolved.releaseLineageId ? { releaseLineageId: resolved.releaseLineageId } : {}),
      ...(resolved.artifactLineageId ? { artifactLineageId: resolved.artifactLineageId } : {}),
      source: resolved.source,
    };
  }
  if (request.publishBehavior === "provision-only") {
    const resolved = await resolveNixosSharedHostProvisionOnlySubmission({
      workspaceRoot: opts.workspaceRoot,
      deployment: request.deployment,
      paths: opts.paths,
      sourceRunId: String(request.sourceRunId || "").trim(),
      backendDatabaseUrl: opts.backend.databaseUrl,
    });
    return {
      ...request,
      operationKind: resolved.operationKind,
      deployment: resolved.deployment,
      ...(resolved.artifact ? { artifact: resolved.artifact } : {}),
      ...(resolved.componentArtifacts ? { componentArtifacts: resolved.componentArtifacts } : {}),
      ...(resolved.parentRunId ? { parentRunId: resolved.parentRunId } : {}),
      ...(resolved.releaseLineageId ? { releaseLineageId: resolved.releaseLineageId } : {}),
      ...(resolved.artifactLineageId ? { artifactLineageId: resolved.artifactLineageId } : {}),
      ...(resolved.source ? { source: resolved.source } : {}),
    };
  }
  return request;
}
