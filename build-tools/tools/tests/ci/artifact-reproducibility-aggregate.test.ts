import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateArtifactReproducibilityEvidence,
  assertArtifactReproducibilityAggregate,
  createArtifactReproducibilityRunRecord,
  type ArtifactReproducibilityRunRecord,
  type PublicationSubject,
} from "../../ci/artifact-reproducibility-aggregate";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";
import {
  artifactObservationsForRecords,
  artifactReproducibilityEvidenceFixture,
  graduatedLanguageManifestFixture,
  observationStorePath,
} from "./artifact-reproducibility.fixture";
import type { ArtifactReproducibilityEvidence } from "../../lib/artifact-reproducibility-evidence";
import { deterministicRemoteBuilderHostKey } from "../remote-exec/remote-builder-host-key.fixture";

const registryStorePath = `/nix/store/${"9".repeat(32)}-registry/registry.json`;
const toolClosureRoot = `/nix/store/${"f".repeat(32)}-remote-ci-tools`;
const hash = (value: string) => `sha256:${value.repeat(64)}`;
const store = (value: string, name: string) => `/nix/store/${value.repeat(32)}-${name}`;
const publication: PublicationSubject = {
  kind: "publication",
  subjectSetDigest: hash("7"),
  subjectId: "static-webapp://projects/apps/viberoots-site:app",
  target: "//projects/apps/viberoots-site:app",
  deploymentComponents: ["//projects/deployments/viberoots-site-prod:deploy"],
  outputRole: "static-webapp",
};

function authority(system: string, slot: string) {
  return {
    identity: `reviewed:${system}-${slot}` as const,
    policy: "inherit_config" as const,
    supportedSystem: system as (typeof RELEASE_BUILDER_SYSTEMS)[number],
    registryStorePath,
    policyAssertionStorePath: store(slot, `${system}-policy`),
    probeFlakeStorePath: store(slot, `${system}-probes`),
  };
}

function registry() {
  const builders = RELEASE_BUILDER_SYSTEMS.flatMap((system, systemIndex) =>
    ["a", "b"].map((slot, slotIndex) => {
      const builder = authority(system, slot);
      return {
        identity: builder.identity,
        endpoint: {
          schema: "viberoots.remote-builder-endpoint.v2" as const,
          host: `${system.replaceAll("_", "-")}-${slot}.example.test`,
          port: 22,
          protocol: "ssh-ng" as const,
          user: "nix",
          hostKey: deterministicRemoteBuilderHostKey(`${systemIndex}:${slotIndex}`),
        },
        supportedSystem: builder.supportedSystem,
        policyStorePath: builder.policyAssertionStorePath,
        probeFlakeStorePath: builder.probeFlakeStorePath,
      };
    }),
  ).sort((left, right) => left.identity.localeCompare(right.identity));
  return {
    schema: "viberoots.reviewed-remote-builders.v3" as const,
    evidenceStore: {
      schema: "viberoots.reproducibility-evidence-store.v1" as const,
      storeUri: "s3://reviewed-evidence/reproducibility",
      signatures: "required" as const,
    },
    builders,
  };
}

function record(evidence: ArtifactReproducibilityEvidence): ArtifactReproducibilityRunRecord {
  return createArtifactReproducibilityRunRecord({
    registryStorePath,
    observationStorePath: observationStorePath(evidence),
    evidence,
  });
}

function operational(records: ArtifactReproducibilityRunRecord[]) {
  return {
    observations: artifactObservationsForRecords(records),
    languageManifest: graduatedLanguageManifestFixture,
  };
}

function records(): ArtifactReproducibilityRunRecord[] {
  const matrix = ARTIFACT_REPRODUCIBILITY_MATRIX.flatMap((matrixCase, matrixIndex) =>
    RELEASE_BUILDER_SYSTEMS.flatMap((system, systemIndex) =>
      ["a", "b"].map((slot, slotIndex) => {
        const bindingDigest = hash(String.fromCharCode(97 + matrixIndex));
        return record(
          artifactReproducibilityEvidenceFixture({
            sourceRevision: matrixIndex.toString(16).padStart(40, "0"),
            system,
            evaluationBundleAuthority: {
              sourceRoot: `${store(String.fromCharCode(97 + matrixIndex), "bundle")}/source`,
              digest: hash("2"),
              bindingDigest,
              replayMaterializations: 2,
            },
            derivationPath: store(String.fromCharCode(97 + matrixIndex), "artifact.drv"),
            outputPath: store(String.fromCharCode(97 + matrixIndex), "artifact"),
            checkoutIdentity: hash(String.fromCharCode(103 + systemIndex * 2 + slotIndex)),
            builderAuthority: authority(system, slot),
            subjectAuthority: {
              kind: "matrix",
              matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
              matrixId: matrixCase.id,
              artifactFamily: matrixCase.artifactFamily,
              recipeDigest: reproducibilityRecipeDigest(matrixCase.id),
              bindingDigest,
              target: matrixCase.graphSelection.target,
            },
          }),
        );
      }),
    ),
  );
  const published = RELEASE_BUILDER_SYSTEMS.flatMap((system, systemIndex) =>
    ["a", "b"].map((slot, slotIndex) =>
      record(
        artifactReproducibilityEvidenceFixture({
          sourceRevision: "f".repeat(40),
          system,
          derivationPath: store("e", `${system}-publication.drv`),
          outputPath: store("e", `${system}-publication`),
          checkoutIdentity: hash(String.fromCharCode(80 + systemIndex * 2 + slotIndex)),
          builderAuthority: authority(system, slot),
          subjectAuthority: publication,
        }),
      ),
    ),
  );
  return [...matrix, ...published];
}

test("aggregate separates temp validation from production publication authority", () => {
  const complete = records();
  const aggregate = aggregateArtifactReproducibilityEvidence({
    registry: registry(),
    registryStorePath,
    publicationSubjects: [publication],
    records: complete,
    ...operational(complete),
    expectedSourceRevision: "f".repeat(40),
    expectedToolClosureRoot: toolClosureRoot,
  });
  assert.equal(aggregate.matrixComparisons.length, 18);
  assert.equal(aggregate.publicationComparisons.length, 3);
  assert.equal(aggregate.sourceRevision, "f".repeat(40));
  assert.notEqual(
    aggregate.matrixComparisons[0]!.artifactIdentity.sourceRevision,
    aggregate.sourceRevision,
  );
  assert.doesNotThrow(() =>
    assertArtifactReproducibilityAggregate({
      aggregate,
      registry: registry(),
      registryStorePath,
      publicationSubjects: [publication],
    }),
  );
});

test("aggregate rejects incomplete records and cross-builder matrix drift", () => {
  const complete = records();
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: complete.slice(1),
        ...operational(complete.slice(1)),
        expectedSourceRevision: "f".repeat(40),
        expectedToolClosureRoot: toolClosureRoot,
      }),
    /exactly 42 records/,
  );
  const drifted = structuredClone(complete);
  drifted[0]!.evidence.sourceRevision = "d".repeat(40);
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: drifted,
        ...operational(drifted),
        expectedSourceRevision: "f".repeat(40),
        expectedToolClosureRoot: toolClosureRoot,
      }),
    /builders disagree/,
  );
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: complete,
        ...operational(complete),
        expectedSourceRevision: "e".repeat(40),
        expectedToolClosureRoot: toolClosureRoot,
      }),
    /protected source revision/,
  );
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: complete,
        ...operational(complete),
        expectedSourceRevision: "f".repeat(40),
        expectedToolClosureRoot: `/nix/store/${"d".repeat(32)}-wrong-tools`,
      }),
    /reviewed tool closure/,
  );
  const wrongToolDigest = structuredClone(complete);
  wrongToolDigest[0]!.evidence.toolClosureDigest = hash("0");
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: wrongToolDigest,
        ...operational(wrongToolDigest),
        expectedSourceRevision: "f".repeat(40),
        expectedToolClosureRoot: toolClosureRoot,
      }),
    /reviewed tool closure/,
  );
});
