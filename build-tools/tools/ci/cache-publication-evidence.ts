import type { ArtifactReproducibilityAggregate } from "./artifact-reproducibility-aggregate";
import { RELEASE_BUILDER_SYSTEMS } from "../lib/artifact-reproducibility-matrix";
import type { CacheManifest } from "./cache-manifest";

export type SignedArtifactReproducibilityAggregate = {
  storePath: string;
  aggregate: ArtifactReproducibilityAggregate;
  evidenceStoreUri: string;
};

export type SystemReproducibilityOutput = {
  subjectId: string;
  outputPath: string;
};

export function systemReproducibilityOutputs(
  signed: SignedArtifactReproducibilityAggregate,
  system: string,
): SystemReproducibilityOutput[] {
  assertCompleteAggregate(signed.aggregate);
  if (!RELEASE_BUILDER_SYSTEMS.some((releaseSystem) => releaseSystem === system)) {
    throw new Error(`cache publication does not support Nix system ${system}`);
  }
  const comparisons = signed.aggregate.publicationComparisons.filter(
    (comparison) => comparison.system === system,
  );
  return comparisons.map((comparison) => ({
    subjectId: comparison.subjectId,
    outputPath: comparison.artifactIdentity.outputPath,
  }));
}

function assertCompleteAggregate(aggregate: ArtifactReproducibilityAggregate): void {
  const subjects = new Set(aggregate.publicationComparisons.map(({ subjectId }) => subjectId));
  if (subjects.size === 0) {
    throw new Error("cache publication requires signed publication comparisons");
  }
  const expected = subjects.size * RELEASE_BUILDER_SYSTEMS.length;
  if (aggregate.publicationComparisons.length !== expected) {
    throw new Error(`cache publication requires all ${expected} publication comparisons`);
  }
  for (const subjectId of subjects) {
    for (const system of RELEASE_BUILDER_SYSTEMS) {
      const matches = aggregate.publicationComparisons.filter(
        (comparison) => comparison.subjectId === subjectId && comparison.system === system,
      );
      if (
        matches.length !== 1 ||
        matches[0]!.artifactIdentity.subjectAuthority.kind !== "publication"
      ) {
        throw new Error(
          `cache publication aggregate has invalid publication coverage for ${subjectId}/${system}`,
        );
      }
    }
  }
}

export function assertCachePublicationEvidence(
  manifest: CacheManifest,
  signed: SignedArtifactReproducibilityAggregate | undefined,
): void {
  if (manifest.schemaVersion !== 3) throw new Error("cache publication requires manifest schema 3");
  if (!signed || signed.storePath !== manifest.reproducibilityAggregateStorePath) {
    throw new Error("cache publication requires its exact signed reproducibility aggregate");
  }
  const published = unique([...manifest.attrs.flatMap((entry) => entry.outputPaths)]);
  const proven = systemReproducibilityOutputs(signed, manifest.system).map(
    ({ outputPath }) => outputPath,
  );
  if (!sameValues(published, proven)) {
    throw new Error(
      "cache publication roots must exactly match the signed aggregate outputs for its Nix system",
    );
  }
  if (signed.aggregate.sourceRevision !== manifest.sourceRevision) {
    throw new Error("cache publication reproducibility evidence has a mismatched source revision");
  }
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
