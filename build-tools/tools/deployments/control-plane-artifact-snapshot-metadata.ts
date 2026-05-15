#!/usr/bin/env zx-wrapper
import { writeBackendArtifactObjectMetadata } from "./control-plane-artifact-metadata";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { BackendQueryable } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import type { ControlPlaneArtifactObject } from "./control-plane-artifact-store-types";

function snapshotObjects(
  snapshot: NixosSharedHostControlPlaneSnapshot,
): ControlPlaneArtifactObject[] {
  const objects: ControlPlaneArtifactObject[] = [];
  if ((snapshot as any).executionSnapshotObject)
    objects.push((snapshot as any).executionSnapshotObject);
  if ((snapshot as any).artifact?.object) objects.push((snapshot as any).artifact.object);
  for (const component of (snapshot as any).componentArtifacts || []) {
    if (component.object) objects.push(component.object);
  }
  const publishInput =
    (snapshot as any).action?.kind === "deploy" ? (snapshot as any).action.publishInput : undefined;
  if (!publishInput) return objects;
  if (publishInput.kind === "exact-artifact") {
    if (publishInput.artifact.object) objects.push(publishInput.artifact.object);
    return objects;
  }
  for (const component of publishInput.components) {
    if (component.artifact.object) objects.push(component.artifact.object);
  }
  return objects;
}

export async function writeBackendSnapshotArtifactObjects(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget | BackendQueryable;
  snapshot: NixosSharedHostControlPlaneSnapshot;
}) {
  for (const object of snapshotObjects(opts.snapshot)) {
    await writeBackendArtifactObjectMetadata({ backend: opts.backend, object });
  }
}
