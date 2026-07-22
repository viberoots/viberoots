import crypto from "node:crypto";
import {
  artifactToolClosureDigest,
  type ArtifactReproducibilityEvidence,
} from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";
import type { ArtifactReproducibilityRunRecord } from "../../ci/artifact-reproducibility-aggregate";
import type { ArtifactReproducibilityObservation } from "../../lib/artifact-reproducibility-observation";
import { artifactObservationFinalizationBoundary } from "../../lib/artifact-reproducibility-finalization";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

export function artifactReproducibilityEvidenceFixture(
  overrides: Partial<ArtifactReproducibilityEvidence> = {},
): ArtifactReproducibilityEvidence {
  return {
    schema: "viberoots.artifact-reproducibility-evidence.v4",
    classification: "hermetic",
    sourceRevision: "a".repeat(40),
    immutableSourceDigest: hash("1"),
    evaluationBundleAuthority: {
      sourceRoot: `/nix/store/${"e".repeat(32)}-evaluation-bundle/source`,
      digest: hash("2"),
      bindingDigest: hash("8"),
      replayMaterializations: 2,
    },
    declaredGraphDigest: hash("3"),
    dependencyLockDigest: hash("4"),
    toolClosureDigest: artifactToolClosureDigest(`/nix/store/${"f".repeat(32)}-remote-ci-tools`),
    toolClosureRoot: `/nix/store/${"f".repeat(32)}-remote-ci-tools`,
    system: "x86_64-linux",
    derivationPath: `/nix/store/${"a".repeat(32)}-artifact.drv`,
    outputPath: `/nix/store/${"b".repeat(32)}-artifact`,
    narHash: hash("6"),
    closureIdentityDigest: hash("a"),
    subjectAuthority: {
      kind: "matrix",
      matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
      matrixId: "go-lib",
      artifactFamily: "go",
      recipeDigest: reproducibilityRecipeDigest("go-lib"),
      bindingDigest: hash("8"),
      target: "//projects/libs/repro-go:repro-go",
    },
    checkoutIdentity: hash("7"),
    builderAuthority: {
      identity: "reviewed:builder-one",
      policy: "inherit_config",
      supportedSystem: "x86_64-linux",
      registryStorePath: `/nix/store/${"9".repeat(32)}-registry/registry.json`,
      policyAssertionStorePath: `/nix/store/${"c".repeat(32)}-builder-attestation`,
      probeFlakeStorePath: `/nix/store/${"8".repeat(32)}-builder-probes`,
    },
    forcedRebuild: true,
    warmIdentityStable: true,
    ...overrides,
  };
}

export function observationStorePath(evidence: ArtifactReproducibilityEvidence): string {
  return observationStorePathForObservation(observationFixture(evidence));
}

export function artifactObservationsForRecords(records: ArtifactReproducibilityRunRecord[]) {
  return records.map((record) => {
    const observation = observationFixture(record.evidence);
    const storePath = observationStorePathForObservation(observation);
    if (record.observationStorePath !== storePath) {
      throw new Error("fixture run record does not bind its content-addressed observation");
    }
    return { storePath, observation };
  });
}

export function observationFixture(
  evidence: ArtifactReproducibilityEvidence,
): ArtifactReproducibilityObservation {
  const subjectId =
    evidence.subjectAuthority.kind === "matrix"
      ? evidence.subjectAuthority.matrixId
      : evidence.subjectAuthority.subjectId;
  return {
    schema: "viberoots.artifact-reproducibility-observation.v4",
    profile:
      evidence.subjectAuthority.kind === "matrix" ? "matrix-consumer" : "publication-subject",
    subjectId,
    system: evidence.system,
    checkoutIdentity: evidence.checkoutIdentity,
    builderIdentity: evidence.builderAuthority.identity,
    finalizationBoundary: artifactObservationFinalizationBoundary(),
    phases: [
      ...(evidence.subjectAuthority.kind === "matrix"
        ? [
            { phase: "temp-consumer-scaffold" as const, elapsedMs: 12 },
            { phase: "evaluation-bundle-one" as const, elapsedMs: 13 },
            { phase: "evaluation-bundle-two" as const, elapsedMs: 13 },
            { phase: "owned-root-cleanup" as const, elapsedMs: 2 },
          ]
        : [
            { phase: "evaluation-bundle-one" as const, elapsedMs: 13 },
            { phase: "evaluation-bundle-two" as const, elapsedMs: 13 },
          ]),
      { phase: "initial-build", elapsedMs: 10 },
      { phase: "forced-rebuild", elapsedMs: 11 },
      { phase: "warm-build", elapsedMs: 9 },
    ],
    stores: {
      local: { beforeCount: 1, afterCount: 1, newNarSize: 0, newPaths: [] },
      remote: { beforeCount: 1, afterCount: 1, newNarSize: 0, newPaths: [] },
    },
    localTempRoot: {
      rootClass: "owned-ci-cell",
      before: { fileCount: 1, dirCount: 1, kb: 4 },
      after: { fileCount: 2, dirCount: 1, kb: 8 },
      deltaKib: 4,
      maxDeltaKib: 2 * 1024 * 1024,
    },
    lifecycle: {
      managedCommandCount: 8,
      closedProcessGroupCount: 8,
      survivingProcessGroupCount: 0,
      processGroups: Array.from({ length: 8 }, (_, index) => ({
        leaderPid: 1000 + index,
        processGroupId: 1000 + index,
        descendantInspection: "verified" as const,
        observedDescendantPids: [],
        descendantsClosed: true as const,
      })),
      managedCommands: "closed",
      ownedRootCleanup: evidence.subjectAuthority.kind === "matrix" ? "verified" : "not-applicable",
      openFileInspection: "verified",
      openFileOwnerCount: 0,
      deletedOpenFileInspection: "verified",
      deletedOpenFileOwnerCount: 0,
      hiddenCaptureInspection: "verified",
      captureState: "absent",
    },
  };
}

export const graduatedLanguageManifestFixture = {
  enabled: ["cpp", "go", "node", "python"],
  languages: [
    language("cpp", ["bin", "lib"], ["cpp-lib"]),
    language("go", ["lib"], ["go-lib"]),
    language("node", ["lib"], ["mixed-artifact", "node-artifact"]),
    language("python", ["app", "wasm"], ["python-artifact", "wasm-artifact"]),
  ],
};

function language(id: string, kinds: string[], reproducibilityMatrixIds: string[]) {
  return { id, kinds, hermetic: { status: "graduated", reproducibilityMatrixIds } };
}

function observationStorePathForObservation(
  observation: ArtifactReproducibilityObservation,
): string {
  const identity = crypto
    .createHash("sha256")
    .update(JSON.stringify(observation))
    .digest("hex")
    .slice(0, 32);
  return `/nix/store/${identity}-observation/run-observation.json`;
}
