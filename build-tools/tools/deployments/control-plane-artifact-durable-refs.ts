#!/usr/bin/env zx-wrapper
import { artifactObjectReferenceUrl } from "./control-plane-artifact-store";
import type { ControlPlaneArtifactObject } from "./control-plane-artifact-store-types";

type ObjectBackedArtifact = {
  object?: ControlPlaneArtifactObject;
  storedArtifactPath?: string;
  outputDir?: string;
};

function restoreArtifactObjectReference(artifact: ObjectBackedArtifact) {
  if (!artifact.object) return;
  const reference = artifactObjectReferenceUrl(artifact.object);
  if (typeof artifact.storedArtifactPath === "string") artifact.storedArtifactPath = reference;
  if (typeof artifact.outputDir === "string") artifact.outputDir = reference;
}

export function restoreDurableArtifactObjectReferences<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    restoreArtifactObjectReference(node as ObjectBackedArtifact);
    for (const child of Object.values(node as Record<string, unknown>)) visit(child);
  };
  visit(value);
  return value;
}
