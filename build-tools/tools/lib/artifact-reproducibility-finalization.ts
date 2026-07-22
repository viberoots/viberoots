export type ArtifactObservationFinalizationBoundary = {
  artifactOutputEvidenceStoreCopy: "observed";
  containingProducerProcess: "self-container";
  observationStoreRegistration: "post-finalization";
  parentBatchEvidenceStoreCopy: "post-finalization";
  runRecordStoreRegistration: "post-finalization";
};

export function artifactObservationFinalizationBoundary(): ArtifactObservationFinalizationBoundary {
  return {
    artifactOutputEvidenceStoreCopy: "observed",
    containingProducerProcess: "self-container",
    observationStoreRegistration: "post-finalization",
    parentBatchEvidenceStoreCopy: "post-finalization",
    runRecordStoreRegistration: "post-finalization",
  };
}

export function assertArtifactObservationFinalizationBoundary(
  value: ArtifactObservationFinalizationBoundary,
): void {
  const expected = artifactObservationFinalizationBoundary();
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some(
      (key) =>
        value[key as keyof ArtifactObservationFinalizationBoundary] !==
        expected[key as keyof ArtifactObservationFinalizationBoundary],
    )
  ) {
    throw new Error("observation finalization boundary is invalid");
  }
}
