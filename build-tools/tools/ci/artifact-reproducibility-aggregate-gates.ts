import {
  assertArtifactReproducibilityObservation,
  type ArtifactReproducibilityObservation,
} from "../lib/artifact-reproducibility-observation";
import type { ArtifactReproducibilityRunRecord } from "./artifact-reproducibility-aggregate";
import { assertArtifactReproducibilityEvidence } from "../lib/artifact-reproducibility-evidence";

export type StoredArtifactObservation = {
  storePath: string;
  observation: ArtifactReproducibilityObservation;
};

export type ArtifactObservationSummary = {
  schema: "viberoots.artifact-reproducibility-observation-summary.v1";
  observationCount: number;
  maxPhaseElapsedMs: number;
  totalNewNarSize: number;
  observationStorePaths: string[];
};

export function summarizeArtifactObservations(
  records: readonly ArtifactReproducibilityRunRecord[],
  observations: readonly StoredArtifactObservation[],
): ArtifactObservationSummary {
  if (observations.length !== records.length) {
    throw new Error("protected aggregate requires one observation for every run record");
  }
  const byPath = new Map(observations.map((entry) => [entry.storePath, entry.observation]));
  if (byPath.size !== observations.length) {
    throw new Error("protected aggregate observations must have unique immutable paths");
  }
  for (const record of records) {
    const observation = byPath.get(record.observationStorePath);
    if (!observation) throw new Error("run record observation is missing from the cell manifests");
    assertArtifactReproducibilityObservation(observation);
    const evidence = record.evidence;
    const subjectId =
      evidence.subjectAuthority.kind === "matrix"
        ? evidence.subjectAuthority.matrixId
        : evidence.subjectAuthority.subjectId;
    if (
      observation.subjectId !== subjectId ||
      observation.system !== evidence.system ||
      observation.checkoutIdentity !== evidence.checkoutIdentity ||
      observation.builderIdentity !== evidence.builderAuthority.identity ||
      observation.profile !==
        (evidence.subjectAuthority.kind === "matrix" ? "matrix-consumer" : "publication-subject") ||
      observation.lifecycle.ownedRootCleanup !==
        (evidence.subjectAuthority.kind === "matrix" ? "verified" : "not-applicable")
    ) {
      throw new Error("run observation does not bind to its artifact evidence authority");
    }
    byPath.delete(record.observationStorePath);
  }
  if (byPath.size) throw new Error("protected aggregate contains unbound observations");
  const ordered = [...observations].sort((left, right) =>
    left.storePath.localeCompare(right.storePath),
  );
  return {
    schema: "viberoots.artifact-reproducibility-observation-summary.v1",
    observationCount: ordered.length,
    maxPhaseElapsedMs: Math.max(
      0,
      ...ordered.flatMap(({ observation }) => observation.phases.map(({ elapsedMs }) => elapsedMs)),
    ),
    totalNewNarSize: ordered.reduce(
      (total, { observation }) =>
        total + observation.stores.local.newNarSize + observation.stores.remote.newNarSize,
      0,
    ),
    observationStorePaths: ordered.map(({ storePath }) => storePath),
  };
}

export function assertObservationSummary(summary: ArtifactObservationSummary): void {
  if (
    summary.schema !== "viberoots.artifact-reproducibility-observation-summary.v1" ||
    !Number.isSafeInteger(summary.observationCount) ||
    summary.observationCount <= 0 ||
    !Number.isSafeInteger(summary.maxPhaseElapsedMs) ||
    summary.maxPhaseElapsedMs < 0 ||
    !Number.isSafeInteger(summary.totalNewNarSize) ||
    summary.totalNewNarSize < 0 ||
    summary.observationStorePaths.length !== summary.observationCount ||
    new Set(summary.observationStorePaths).size !== summary.observationCount ||
    summary.observationStorePaths.some(
      (entry) => !/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/run-observation\.json$/u.test(entry),
    )
  ) {
    throw new Error("protected aggregate observation summary is invalid");
  }
}

export function assertRunRecordAuthority(
  record: ArtifactReproducibilityRunRecord,
  registryStorePath: string,
): void {
  const keys = Object.keys(record).sort().join("\0");
  if (
    keys !== ["evidence", "observationStorePath", "registryStorePath", "schema"].join("\0") ||
    record.schema !== "viberoots.artifact-reproducibility-run-record.v3" ||
    record.registryStorePath !== registryStorePath
  ) {
    throw new Error("run record authority mismatch");
  }
  assertObservationStorePath(record.observationStorePath);
  assertArtifactReproducibilityEvidence(record.evidence);
}

export function assertObservationStorePath(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/run-observation\.json$/u.test(value)) {
    throw new Error("run record observation must be a canonical immutable observation file");
  }
}
