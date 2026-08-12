import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  aggregateArtifactReproducibilityEvidence,
  assertArtifactReproducibilityAggregate,
} from "../../ci/artifact-reproducibility-aggregate";
import { reproducibilityMatrixSystemPairs } from "../../lib/artifact-reproducibility-matrix";
import { artifactObservationsForRecords } from "./artifact-reproducibility.fixture";
import {
  operational,
  protectedPatchEvidence,
  publication,
  records,
  registry,
  registryStorePath,
  toolClosureRoot,
  toolClosureSourceIdentity,
} from "./artifact-reproducibility-aggregate-fixture";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { recreateProtectedPatchEvidence } from "./protected-rust-patch-evidence.fixture";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

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
    expectedToolClosureSourceIdentity: toolClosureSourceIdentity(),
    protectedRustPatchEvidence: protectedPatchEvidence(),
  });
  assert.equal(aggregate.matrixComparisons.length, reproducibilityMatrixSystemPairs().length);
  assert.equal(aggregate.publicationComparisons.length, 3);
  assert.equal(aggregate.sourceRevision, "f".repeat(40));
  assert.equal(aggregate.toolSourceRevision, "e".repeat(40));
  assert.notEqual(aggregate.sourceRevision, aggregate.toolSourceRevision);
  assert.equal(
    aggregate.matrixComparisons[0]!.artifactIdentity.toolSourceRevision,
    aggregate.toolSourceRevision,
  );
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

test("aggregate signs candidate qualification for the actual experimental Rust manifest", () => {
  const complete = records();
  const aggregate = aggregateArtifactReproducibilityEvidence({
    registry: registry(),
    registryStorePath,
    publicationSubjects: [publication],
    records: complete,
    observations: artifactObservationsForRecords(complete),
    languageManifest: JSON.parse(
      fs.readFileSync(viberootsSourcePath("build-tools/tools/nix/langs.json"), "utf8"),
    ),
    expectedSourceRevision: "f".repeat(40),
    expectedToolClosureRoot: toolClosureRoot,
    expectedToolClosureSourceIdentity: toolClosureSourceIdentity(),
    protectedRustPatchEvidence: protectedPatchEvidence(),
  });
  const rust = aggregate.languageQualification.find(({ languageId }) => languageId === "rust")!;
  assert.deepEqual([rust.status, rust.publicationAdmitted], ["candidate", false]);
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
    new RegExp(`exactly ${complete.length} records`),
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
        expectedToolClosureSourceIdentity: toolClosureSourceIdentity("e".repeat(40)),
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

test("aggregate rejects missing, tampered, wrong-builder, and wrong-source patch evidence", () => {
  const complete = records();
  const base = {
    registry: registry(),
    registryStorePath,
    publicationSubjects: [publication],
    records: complete,
    observations: artifactObservationsForRecords(complete),
    languageManifest: operational(complete).languageManifest,
    expectedSourceRevision: "f".repeat(40),
    expectedToolClosureRoot: toolClosureRoot,
    expectedToolClosureSourceIdentity: toolClosureSourceIdentity(),
  };
  const valid = protectedPatchEvidence();
  for (const mutate of [
    (evidence: typeof valid) => evidence.pop(),
    (evidence: typeof valid) => evidence[0]!.cases.reverse(),
    (evidence: typeof valid) => (evidence[0]!.builderAuthority = evidence[1]!.builderAuthority),
    (evidence: typeof valid) => (evidence[0]!.sourceRevision = "e".repeat(40)),
  ]) {
    const evidence = structuredClone(valid);
    mutate(evidence);
    assert.throws(
      () =>
        aggregateArtifactReproducibilityEvidence({
          ...base,
          protectedRustPatchEvidence: evidence,
        }),
      /protected Rust patch evidence|remote CI tools closure source identity/u,
    );
  }
  const aggregate = aggregateArtifactReproducibilityEvidence({
    ...base,
    protectedRustPatchEvidence: valid,
  });
  aggregate.protectedRustPatchEvidence[0]!.cases[0]!.patched.outputPaths = [
    `/nix/store/${"0".repeat(32)}-tampered`,
  ];
  assert.throws(
    () =>
      assertArtifactReproducibilityAggregate({
        aggregate,
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
      }),
    /protected Rust patch evidence/u,
  );
});

test("protected patch evidence rejects wrong behavior and independently valid divergent slots", () => {
  const valid = protectedPatchEvidence();
  const wrongBehavior = structuredClone(valid[0]!);
  wrongBehavior.cases[0]!.patched.behavior = "42";
  assert.throws(
    () => recreateProtectedPatchEvidence(wrongBehavior),
    /protected Rust patch evidence lifecycle mismatch/u,
  );

  const divergent = structuredClone(valid);
  const second = divergent[1]!;
  const changedBaseline = {
    ...second.cases[0]!.baseline,
    derivationPaths: [`/nix/store/${"1".repeat(32)}-divergent.drv`],
    outputPaths: [`/nix/store/${"1".repeat(32)}-divergent`],
    semanticDigest: hash("1"),
    behaviorDigest: hash("2"),
  };
  second.cases[0]!.baseline = changedBaseline;
  second.cases[0]!.restored = changedBaseline;
  divergent[1] = recreateProtectedPatchEvidence(second);
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        registry: registry(),
        registryStorePath,
        publicationSubjects: [publication],
        records: records(),
        ...operational(records()),
        expectedSourceRevision: "f".repeat(40),
        expectedToolClosureRoot: toolClosureRoot,
        protectedRustPatchEvidence: divergent,
      }),
    /builder slots disagree/u,
  );
});
