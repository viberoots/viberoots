import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateArtifactReproducibilityEvidence } from "../../ci/artifact-reproducibility-aggregate";
import {
  operational,
  protectedPatchEvidence,
  publication,
  records,
  registry,
  registryStorePath,
  toolClosureRoot,
} from "./artifact-reproducibility-aggregate-fixture";
import { recreateProtectedPatchEvidence } from "./protected-rust-patch-evidence.fixture";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

test("protected patch evidence rejects wrong behavior and Pyodide identity tampering", () => {
  const valid = protectedPatchEvidence();
  const wrongBehavior = structuredClone(valid[0]!);
  wrongBehavior.cases[0]!.patched.behavior = "42";
  assert.throws(
    () => recreateProtectedPatchEvidence(wrongBehavior),
    /protected Rust patch evidence lifecycle mismatch/u,
  );
  const pyodideRecord = valid.find(({ cases }) =>
    cases.some(({ caseId }) => caseId === "rust-pyodide-extension-pr14"),
  )!;
  for (const mutate of pyodideMutators()) {
    const tampered = structuredClone(pyodideRecord);
    mutate(tampered.cases.find(({ caseId }) => caseId === "rust-pyodide-extension-pr14")!.baseline);
    assert.throws(
      () => recreateProtectedPatchEvidence(tampered),
      /protected Rust patch evidence lacks Pyodide identity/u,
    );
  }
});

test("protected patch evidence rejects independently valid divergent builder slots", () => {
  const divergent = structuredClone(protectedPatchEvidence());
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

function pyodideMutators(): Array<(phase: any) => void> {
  return [
    (phase) => (phase.pyodideBehavior = `${phase.pyodideBehavior} tampered`),
    (phase) => (phase.pyodideBehaviorDigest = hash("8")),
    (phase) => (phase.pyodideAbiIdentity = { ...phase.pyodideAbiIdentity, backend: "tampered" }),
    (phase) => (phase.pyodideAbiDigest = hash("9")),
  ];
}
