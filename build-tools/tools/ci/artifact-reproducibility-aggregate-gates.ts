import {
  assertArtifactReproducibilityObservation,
  type ArtifactReproducibilityObservation,
} from "../lib/artifact-reproducibility-observation";
import {
  RELEASE_BUILDER_SYSTEMS,
  hasReproducibilityMatrixId,
  reproducibilityMatrixCaseCoversLanguage,
  reproducibilityMatrixCoverage,
} from "../lib/artifact-reproducibility-matrix";
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

export type LanguageGraduationProof = {
  languageId: string;
  matrixIds: string[];
  requiredRoutes: string[];
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

export function proveGraduatedLanguageCoverage(
  manifest: unknown,
  matrixComparisons: readonly { subjectId: string; system: string }[],
): LanguageGraduationProof[] {
  const doc = manifest as {
    enabled?: unknown;
    languages?: unknown;
  };
  if (!Array.isArray(doc.enabled) || !Array.isArray(doc.languages)) {
    throw new Error("protected aggregate requires the immutable language manifest");
  }
  const enabled = [...new Set(doc.enabled.map(String))].sort();
  const languages = new Map(
    doc.languages.map((entry) => [String((entry as { id?: unknown }).id || ""), entry]),
  );
  const successful = new Set<string>();
  for (const id of new Set(matrixComparisons.map(({ subjectId }) => subjectId))) {
    if (
      RELEASE_BUILDER_SYSTEMS.every((system) =>
        matrixComparisons.some(
          (comparison) => comparison.subjectId === id && comparison.system === system,
        ),
      )
    ) {
      successful.add(id);
    }
  }
  return enabled.map((languageId) => {
    const language = languages.get(languageId) as
      | { kinds?: unknown; hermetic?: { status?: unknown; reproducibilityMatrixIds?: unknown } }
      | undefined;
    const matrixIds = Array.isArray(language?.hermetic?.reproducibilityMatrixIds)
      ? language.hermetic.reproducibilityMatrixIds.map(String).sort()
      : [];
    if (language?.hermetic?.status !== "graduated" || !matrixIds.length) {
      throw new Error(`enabled language is not graduated in protected evidence: ${languageId}`);
    }
    for (const matrixId of matrixIds) {
      if (
        !hasReproducibilityMatrixId(matrixId) ||
        !reproducibilityMatrixCaseCoversLanguage(matrixId, languageId) ||
        !successful.has(matrixId)
      ) {
        throw new Error(`graduated language lacks a successful matrix comparison: ${languageId}`);
      }
    }
    const requiredRoutes = new Set<string>(["base"]);
    for (const kind of Array.isArray(language.kinds) ? language.kinds.map(String) : []) {
      if (["wasm", "mixed", "addon"].includes(kind)) requiredRoutes.add(kind);
    }
    const covered = reproducibilityMatrixCoverage(matrixIds, languageId);
    for (const route of requiredRoutes) {
      if (!covered.has(route as "base")) {
        throw new Error(
          `graduated language lacks protected ${route} route evidence: ${languageId}`,
        );
      }
    }
    return { languageId, matrixIds, requiredRoutes: [...requiredRoutes].sort() };
  });
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

export function assertLanguageGraduationProofs(
  proofs: readonly LanguageGraduationProof[],
  comparisons: readonly { subjectId: string; system: string }[],
): void {
  if (!proofs.length) {
    throw new Error("protected aggregate lacks graduated language evidence");
  }
  const ids = proofs.map(({ languageId }) => languageId);
  if (ids.join("\0") !== [...new Set(ids)].sort().join("\0")) {
    throw new Error("graduated language evidence is not canonical");
  }
  for (const proof of proofs) {
    if (!proof.matrixIds.length || !proof.requiredRoutes.includes("base")) {
      throw new Error(`graduated language evidence is incomplete: ${proof.languageId}`);
    }
    const coverage = reproducibilityMatrixCoverage(proof.matrixIds, proof.languageId);
    for (const matrixId of proof.matrixIds) {
      if (
        !reproducibilityMatrixCaseCoversLanguage(matrixId, proof.languageId) ||
        !RELEASE_BUILDER_SYSTEMS.every((system) =>
          comparisons.some(
            (comparison) => comparison.subjectId === matrixId && comparison.system === system,
          ),
        )
      ) {
        throw new Error(
          `graduated language proof lacks successful comparisons: ${proof.languageId}`,
        );
      }
    }
    if (proof.requiredRoutes.some((route) => !coverage.has(route as "base"))) {
      throw new Error(`graduated language proof lacks required routes: ${proof.languageId}`);
    }
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
