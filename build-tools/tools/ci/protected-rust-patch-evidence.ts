import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
} from "../lib/artifact-reproducibility-matrix";
import type { ReviewedRemoteBuilderRegistry } from "../remote-exec/remote-builder-authority";
import { protectedRustPatchCaseDefinitions } from "./protected-rust-patch-case-driver";
import { assertRegisteredArtifactBuilderAuthority } from "./artifact-reproducibility-aggregate-validation";
import { assertRemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";
import {
  assertProtectedEvidenceKeys as exactKeys,
  protectedDigestShape as digestShape,
  protectedEvidenceDigest as digest,
  protectedStorePath as storePath,
} from "./protected-rust-patch-evidence-utils";
import {
  createProtectedRustPatchEvidenceSchema,
  type ProtectedRustPatchEvidence,
} from "./protected-rust-patch-evidence-schema";
export type { ProtectedRustPatchEvidence } from "./protected-rust-patch-evidence-schema";

export function createProtectedRustPatchEvidence(
  value: Omit<ProtectedRustPatchEvidence, "identityDigest" | "schema" | "caseSetDigest">,
): ProtectedRustPatchEvidence {
  assertCanonicalCases(value.system, value.cases);
  return createProtectedRustPatchEvidenceSchema(value);
}

export function assertProtectedRustPatchEvidenceSet(opts: {
  evidence: readonly ProtectedRustPatchEvidence[];
  registry: ReviewedRemoteBuilderRegistry;
  registryStorePath: string;
  sourceRevision: string;
  toolSourceRevision?: string;
  toolClosureSourceIdentity?: ProtectedRustPatchEvidence["toolClosureSourceIdentity"];
}): void {
  if (opts.evidence.length !== RELEASE_BUILDER_SYSTEMS.length * 2) {
    throw new Error("protected Rust patch evidence requires every system and builder slot");
  }
  const expectedKeys = RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
    ["one", "two"].map((slot) => `${system}\0${slot}`),
  );
  const buildersBySystem = new Map(
    RELEASE_BUILDER_SYSTEMS.map((system) => [
      system,
      opts.registry.builders.filter((builder) => builder.supportedSystem === system),
    ]),
  );
  for (const [index, evidence] of opts.evidence.entries()) {
    exactKeys(evidence, [
      "builderAuthority",
      "builderSlot",
      "caseSetDigest",
      "cases",
      "identityDigest",
      "remoteStoreRequired",
      "schema",
      "sourceRevision",
      "system",
      "toolClosureSourceIdentity",
      "toolSourceRevision",
    ]);
    const key = `${evidence.system}\0${evidence.builderSlot}`;
    const expectedBuilder = buildersBySystem.get(evidence.system)?.[
      evidence.builderSlot === "one" ? 0 : 1
    ];
    assertCanonicalCases(evidence.system, evidence.cases);
    assertRemoteCiToolsSourceIdentity(
      evidence.toolClosureSourceIdentity,
      evidence.toolSourceRevision,
    );
    if (
      key !== expectedKeys[index] ||
      evidence.schema !== "viberoots.protected-rust-patch-evidence.v6" ||
      evidence.sourceRevision !== opts.sourceRevision ||
      (opts.toolSourceRevision && evidence.toolSourceRevision !== opts.toolSourceRevision) ||
      evidence.remoteStoreRequired !== true ||
      evidence.toolClosureSourceIdentity.toolSourceRevision !== evidence.toolSourceRevision ||
      evidence.caseSetDigest !== digest(evidence.cases) ||
      evidence.identityDigest !== digest({ ...evidence, identityDigest: undefined }) ||
      !expectedBuilder ||
      evidence.builderAuthority.identity !== expectedBuilder.identity
    ) {
      throw new Error(`protected Rust patch evidence authority mismatch: ${key}`);
    }
    assertRegisteredArtifactBuilderAuthority(
      evidence.builderAuthority,
      expectedBuilder,
      opts.registryStorePath,
    );
  }
  if (
    new Set(opts.evidence.map((entry) => JSON.stringify(entry.toolClosureSourceIdentity))).size !==
    1
  ) {
    throw new Error("protected Rust patch evidence uses different tool closure sources");
  }
  if (
    opts.toolClosureSourceIdentity &&
    opts.evidence.some(
      (entry) =>
        JSON.stringify(entry.toolClosureSourceIdentity) !==
        JSON.stringify(opts.toolClosureSourceIdentity),
    )
  ) {
    throw new Error("protected Rust patch evidence uses a stale tool closure source");
  }
  for (const system of RELEASE_BUILDER_SYSTEMS) {
    const slots = opts.evidence.filter((entry) => entry.system === system);
    if (slots.length !== 2 || JSON.stringify(slots[0]!.cases) !== JSON.stringify(slots[1]!.cases)) {
      throw new Error(`protected Rust patch evidence builder slots disagree: ${system}`);
    }
  }
}

function assertCanonicalCases(
  system: string,
  cases: readonly ProtectedRustPatchCaseResult[],
): void {
  const expected = protectedRustPatchCaseDefinitions(system);
  if (
    cases.length !== expected.length ||
    cases.some(
      (entry, index) =>
        entry.caseId !== expected[index]!.id ||
        !entry.driverSource.endsWith("/build-tools/tools/ci/protected-rust-patch-case-driver.ts") ||
        !entry.workflowSource.endsWith("/build-tools/tools/patch/patch-rust.ts"),
    )
  ) {
    throw new Error("protected Rust patch evidence case set is not canonical");
  }
  for (const [caseIndex, entry] of cases.entries()) {
    const definition = expected[caseIndex]!;
    exactKeys(entry, [
      "baseline",
      "caseId",
      "driverSource",
      "patchPath",
      "patched",
      "restored",
      "workflowActions",
      "workflowSource",
    ]);
    if (
      JSON.stringify(entry.workflowActions) !== JSON.stringify(["start", "apply", "remove"]) ||
      !entry.patchPath.includes("/patches/rust/") ||
      !entry.patchPath.endsWith(".patch")
    ) {
      throw new Error(`protected Rust patch evidence lacks its workflow: ${entry.caseId}`);
    }
    for (const phase of [entry.baseline, entry.patched, entry.restored]) {
      exactKeys(phase, [
        "behavior",
        "behaviorDigest",
        "consumerCommit",
        "consumerTree",
        "derivationPaths",
        "evaluationBundleDigest",
        "graphDigest",
        "graphBindingDigest",
        "matrixDigest",
        "outputPaths",
        "patchDigest",
        "reachableNodes",
        "reachableNodesDigest",
        "semanticDigest",
        "sourceTreeDigest",
      ]);
      if (
        !phase.derivationPaths.every(storePath) ||
        !phase.outputPaths.every(storePath) ||
        phase.derivationPaths.length === 0 ||
        phase.outputPaths.length === 0 ||
        !digestShape(phase.semanticDigest) ||
        !digestShape(phase.behaviorDigest) ||
        !digestShape(phase.graphDigest) ||
        !digestShape(phase.graphBindingDigest) ||
        !digestShape(phase.matrixDigest) ||
        !digestShape(phase.evaluationBundleDigest) ||
        !/^sha256-[A-Za-z0-9+/=]+$/u.test(phase.sourceTreeDigest) ||
        !/^[a-f0-9]{40,64}$/u.test(phase.consumerCommit) ||
        !/^[a-f0-9]{40,64}$/u.test(phase.consumerTree) ||
        !digestShape(phase.reachableNodesDigest) ||
        phase.matrixDigest !== ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST ||
        phase.reachableNodesDigest !== digest(phase.reachableNodes)
      ) {
        throw new Error(`protected Rust patch evidence has invalid phase: ${entry.caseId}`);
      }
      if (
        phase.reachableNodes.length !== definition.matrixCase.languageProofs.length ||
        phase.reachableNodes.some((node, index) => {
          const proof = definition.matrixCase.languageProofs[index]!;
          return (
            node.name !== proof.target ||
            !proof.ruleTypes.includes(node.ruleType) ||
            JSON.stringify(node.kinds) !==
              JSON.stringify(proof.requiredLabels.filter((label) => label.startsWith("kind:")))
          );
        })
      ) {
        throw new Error(
          `protected Rust patch evidence has invalid reachable nodes: ${entry.caseId}`,
        );
      }
    }
    if (
      entry.baseline.consumerCommit === entry.patched.consumerCommit ||
      entry.patched.consumerCommit === entry.restored.consumerCommit ||
      entry.baseline.consumerTree !== entry.restored.consumerTree ||
      entry.baseline.consumerTree === entry.patched.consumerTree ||
      entry.baseline.evaluationBundleDigest !== entry.restored.evaluationBundleDigest ||
      entry.baseline.evaluationBundleDigest === entry.patched.evaluationBundleDigest ||
      entry.baseline.sourceTreeDigest !== entry.restored.sourceTreeDigest ||
      entry.baseline.graphDigest !== entry.restored.graphDigest ||
      entry.baseline.graphDigest === entry.patched.graphDigest ||
      entry.baseline.graphBindingDigest !== entry.patched.graphBindingDigest ||
      entry.baseline.graphBindingDigest !== entry.restored.graphBindingDigest ||
      entry.baseline.reachableNodesDigest !== entry.patched.reachableNodesDigest ||
      entry.baseline.reachableNodesDigest !== entry.restored.reachableNodesDigest ||
      entry.baseline.patchDigest !== null ||
      !digestShape(entry.patched.patchDigest || "") ||
      entry.restored.patchDigest !== null ||
      entry.baseline.derivationPaths.length !== entry.patched.derivationPaths.length ||
      entry.baseline.outputPaths.length !== entry.patched.outputPaths.length ||
      entry.baseline.derivationPaths.some(
        (value, index) => value === entry.patched.derivationPaths[index],
      ) ||
      entry.baseline.outputPaths.some(
        (value, index) => value === entry.patched.outputPaths[index],
      ) ||
      entry.baseline.semanticDigest === entry.patched.semanticDigest ||
      entry.baseline.behaviorDigest === entry.patched.behaviorDigest ||
      entry.baseline.behavior !== "42" ||
      entry.patched.behavior !== "43" ||
      JSON.stringify({ ...entry.baseline, consumerCommit: "" }) !==
        JSON.stringify({ ...entry.restored, consumerCommit: "" })
    ) {
      throw new Error(`protected Rust patch evidence lifecycle mismatch: ${entry.caseId}`);
    }
  }
}
