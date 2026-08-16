import crypto from "node:crypto";
import {
  createArtifactReproducibilityRunRecord,
  type ArtifactReproducibilityRunRecord,
  type PublicationSubject,
} from "../../ci/artifact-reproducibility-aggregate";
import type { ArtifactReproducibilityEvidence } from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";
import { deterministicRemoteBuilderHostKey } from "../remote-exec/remote-builder-host-key.fixture";
import {
  artifactObservationsForRecords,
  artifactReproducibilityEvidenceFixture,
  graduatedLanguageManifestFixture,
  observationStorePath,
} from "./artifact-reproducibility.fixture";
import { createProtectedRustPatchEvidence } from "../../ci/protected-rust-patch-evidence";
import { protectedRustPatchCaseDefinitions } from "../../ci/protected-rust-patch-case-driver";
import { remoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity.fixture";
import { protectedPyodideFixture } from "./protected-pyodide-fixture";
import {
  tauriSemanticManifestBytes,
  tauriSemanticManifestDigest,
} from "./tauri-semantic-manifest.fixture";
import { semanticForMatrixCase } from "./artifact-semantic-fixture";
export { tauriSemanticManifestBytes, tauriSemanticManifestDigest };
export const registryStorePath = `/nix/store/${"9".repeat(32)}-registry/registry.json`;
export const toolClosureRoot = `/nix/store/${"f".repeat(32)}-remote-ci-tools`;
export const toolClosureSourceIdentity = (toolSourceRevision = "e".repeat(40)) =>
  remoteCiToolsSourceIdentity(toolSourceRevision);
const builderSlots = ["a", "b"] as const;
const hash = (value: string) => `sha256:${value.repeat(64)}`;
const store = (value: string, name: string) => `/nix/store/${value.repeat(32)}-${name}`;
export const publication: PublicationSubject = {
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

export function registry() {
  const builders = RELEASE_BUILDER_SYSTEMS.flatMap((system, systemIndex) =>
    builderSlots.map((slot, slotIndex) => {
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

export function operational(records: ArtifactReproducibilityRunRecord[]) {
  return {
    observations: artifactObservationsForRecords(records),
    languageManifest: graduatedLanguageManifestFixture,
    protectedRustPatchEvidence: protectedPatchEvidence(),
    expectedToolClosureSourceIdentity: toolClosureSourceIdentity(),
  };
}

export function protectedPatchEvidence(
  sourceRevision = "f".repeat(40),
  toolSourceRevision = "e".repeat(40),
) {
  return RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
    builderSlots.map((slot, index) =>
      createProtectedRustPatchEvidence({
        sourceRevision,
        toolSourceRevision,
        system,
        builderSlot: index === 0 ? "one" : "two",
        builderAuthority: authority(system, slot),
        remoteStoreRequired: true,
        toolClosureSourceIdentity: toolClosureSourceIdentity(toolSourceRevision),
        cases: protectedRustPatchCaseDefinitions(system).map((testCase, caseIndex) => {
          const baseline = patchPhase(testCase, system, caseIndex, "baseline");
          return {
            caseId: testCase.id,
            driverSource: `${toolClosureRoot}/share/viberoots-source/build-tools/tools/ci/protected-rust-patch-case-driver.ts`,
            workflowSource: `${toolClosureRoot}/share/viberoots-source/build-tools/tools/patch/patch-rust.ts`,
            workflowActions: ["start", "apply", "remove"] as ["start", "apply", "remove"],
            patchPath: `${testCase.cargoRoot}/patches/rust/dependency.patch`,
            baseline,
            patched: patchPhase(testCase, system, caseIndex, "patched"),
            restored: patchPhase(testCase, system, caseIndex, "restored"),
          };
        }),
      }),
    ),
  );
}

function patchPhase(
  testCase: ReturnType<typeof protectedRustPatchCaseDefinitions>[number],
  system: string,
  index: number,
  phase: string,
) {
  const state = phase === "patched" ? "patched" : "baseline";
  const seed = crypto.createHash("sha256").update(`${system}:${index}:${state}`).digest("hex");
  const storeHash = seed.slice(0, 32).replace(/[eotu]/gu, "a");
  const reachableNodes = testCase.matrixCase.languageProofs.map((proof) => ({
    name: proof.target,
    ruleType: proof.ruleTypes[0]!,
    kinds: proof.requiredLabels.filter((label) => label.startsWith("kind:")),
  }));
  const pyodide = protectedPyodideFixture(testCase.id, state);
  return {
    derivationPaths: [`/nix/store/${storeHash}-${state}.drv`],
    outputPaths: [`/nix/store/${storeHash}-${state}`],
    semanticDigest: `sha256:${seed}`,
    behaviorDigest: `sha256:${seed}`,
    behavior: state === "patched" ? "43" : "42",
    ...pyodide,
    graphDigest: patchHash(`${system}:${index}:${state}:graph`),
    graphBindingDigest: patchHash(`${system}:${index}:binding`),
    matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
    evaluationBundleDigest: patchHash(`${system}:${index}:${state}:bundle`),
    sourceTreeDigest: `sha256-${Buffer.from(`${system}:${index}:${state}`).toString("base64")}`,
    consumerCommit: patchHash(`${system}:${index}:${phase}:commit`).slice("sha256:".length, 40 + 7),
    consumerTree: patchHash(`${system}:${index}:${state}:tree`).slice("sha256:".length, 40 + 7),
    patchDigest: state === "patched" ? patchHash(`${system}:${index}:patch`) : null,
    reachableNodes,
    reachableNodesDigest: hashJson(reachableNodes),
  };
}
function patchHash(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function hashJson(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function records(): ArtifactReproducibilityRunRecord[] {
  const matrix = ARTIFACT_REPRODUCIBILITY_MATRIX.flatMap((matrixCase, matrixIndex) =>
    matrixCase.systems.flatMap((system, systemIndex) =>
      builderSlots.map((slot, slotIndex) => {
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
            ...semanticForMatrixCase(
              matrixCase,
              store(String.fromCharCode(97 + matrixIndex), "artifact"),
              matrixCase.id === "rust-tauri-darwin-pr12" ? tauriSemanticManifestDigest : hash("8"),
            ),
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
    builderSlots.map((slot, slotIndex) =>
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
