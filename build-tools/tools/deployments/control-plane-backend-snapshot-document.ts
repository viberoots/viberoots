#!/usr/bin/env zx-wrapper

type SnapshotDoc = { submissionId: string };

export function backendSnapshotPersistenceDoc(doc: SnapshotDoc) {
  const executionSnapshotObject = (doc as any).executionSnapshotObject;
  if (!executionSnapshotObject) return doc;
  const artifactObjects: unknown[] = [];
  if ((doc as any).artifact?.object) artifactObjects.push((doc as any).artifact.object);
  for (const component of (doc as any).componentArtifacts || []) {
    if (component.object) artifactObjects.push(component.object);
  }
  const publishInput =
    (doc as any).action?.kind === "deploy" ? (doc as any).action.publishInput : undefined;
  if (publishInput?.kind === "exact-artifact" && publishInput.artifact?.object) {
    artifactObjects.push(publishInput.artifact.object);
  }
  for (const component of publishInput?.components || []) {
    if (component.artifact?.object) artifactObjects.push(component.artifact.object);
  }
  return {
    schemaVersion: "control-plane-execution-snapshot-reference@1",
    submissionId: doc.submissionId,
    deploymentId: (doc as any).deploymentId,
    executionSnapshotObject,
    artifactObjects,
  };
}
