#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";

export function finalizedStagedArtifactReference(
  request: Pick<
    NixosSharedHostControlPlaneSubmitRequest,
    "artifactDir" | "artifactDirsByComponentId"
  >,
): string | undefined {
  return request.artifactDir || JSON.stringify(request.artifactDirsByComponentId);
}

export function hasFinalizedStagedArtifactReference(
  request: Pick<
    NixosSharedHostControlPlaneSubmitRequest,
    "artifactDir" | "artifactDirsByComponentId"
  >,
): boolean {
  return Boolean(request.artifactDir || request.artifactDirsByComponentId);
}

export function assertProtectedSharedArtifactIdentityFields(
  request: Pick<
    NixosSharedHostControlPlaneSubmitRequest,
    | "artifactDir"
    | "artifactDirsByComponentId"
    | "expectedArtifactIdentity"
    | "expectedComponentArtifactIdentities"
    | "expectedCompositeArtifactIdentity"
  >,
) {
  if (!hasFinalizedStagedArtifactReference(request)) return;
  if (request.artifactDirsByComponentId) {
    if (!request.expectedComponentArtifactIdentities) {
      throw new Error(
        "protected/shared multi-component artifact submit requires expectedComponentArtifactIdentities",
      );
    }
    if (!request.expectedCompositeArtifactIdentity) {
      throw new Error(
        "protected/shared multi-component artifact submit requires expectedCompositeArtifactIdentity",
      );
    }
    return;
  }
  if (!request.expectedArtifactIdentity) {
    throw new Error("protected/shared artifact submit requires expectedArtifactIdentity");
  }
}
