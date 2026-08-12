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

const hash = (value: string) => `sha256:${value.repeat(64)}`;

test("protected patch evidence rejects phase identity and reachability tampering", () => {
  for (const mutate of [
    (evidence: ReturnType<typeof protectedPatchEvidence>[number]) => {
      evidence.cases[0]!.patched.graphDigest = hash("0");
    },
    (evidence: ReturnType<typeof protectedPatchEvidence>[number]) => {
      evidence.cases[0]!.patched.evaluationBundleDigest = hash("0");
    },
    (evidence: ReturnType<typeof protectedPatchEvidence>[number]) => {
      evidence.cases[0]!.patched.patchDigest = null;
    },
    (evidence: ReturnType<typeof protectedPatchEvidence>[number]) => {
      evidence.cases[0]!.patched.reachableNodes = [
        { name: "//projects/forged:node", ruleType: "genrule", kinds: ["kind:app"] },
      ];
      evidence.cases[0]!.patched.reachableNodesDigest = hash(
        JSON.stringify(evidence.cases[0]!.patched.reachableNodes),
      );
    },
  ]) {
    const protectedEvidence = structuredClone(protectedPatchEvidence());
    mutate(protectedEvidence[0]!);
    const complete = records();
    assert.throws(
      () =>
        aggregateArtifactReproducibilityEvidence({
          registry: registry(),
          registryStorePath,
          publicationSubjects: [publication],
          records: complete,
          ...operational(complete),
          expectedSourceRevision: "f".repeat(40),
          expectedToolClosureRoot: toolClosureRoot,
          protectedRustPatchEvidence: protectedEvidence,
        }),
      /protected Rust patch evidence/u,
    );
  }
});
