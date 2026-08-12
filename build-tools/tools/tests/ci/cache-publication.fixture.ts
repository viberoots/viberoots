import crypto from "node:crypto";
import {
  aggregateArtifactReproducibilityEvidence,
  createArtifactReproducibilityRunRecord,
  type PublicationSubject,
} from "../../ci/artifact-reproducibility-aggregate";
import type { SignedArtifactReproducibilityAggregate } from "../../ci/cache-publication-evidence";
import { createProtectedRustPatchEvidence } from "../../ci/protected-rust-patch-evidence";
import { protectedRustPatchCaseDefinitions } from "../../ci/protected-rust-patch-case-driver";
import {
  artifactToolClosureDigest,
  type ArtifactReproducibilityEvidence,
} from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
  reproducibilityMatrixCase,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";
import { deterministicRemoteBuilderHostKey } from "../remote-exec/remote-builder-host-key.fixture";
import {
  artifactObservationsForRecords,
  graduatedLanguageManifestFixture,
  observationStorePath,
} from "./artifact-reproducibility.fixture";
import { remoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity.fixture";

const registryStorePath = `/nix/store/${"9".repeat(32)}-registry/registry.json`;
const digest = (value: string) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const store = (value: string, name: string) =>
  `/nix/store/${crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)}-${name}`;
const toolClosureSourceIdentity = remoteCiToolsSourceIdentity("b".repeat(40));

export const productionPublicationSubject: PublicationSubject = {
  kind: "publication",
  subjectSetDigest: digest("production-subjects"),
  subjectId: "viberoots-site-static-webapp",
  target: "//projects/apps/viberoots-site:app",
  deploymentComponents: ["//projects/deployments/viberoots-site-prod:deploy"],
  outputRole: "static-webapp",
};

function authority(system: (typeof RELEASE_BUILDER_SYSTEMS)[number], slot: "a" | "b") {
  return {
    identity: `reviewed:${system}-${slot}` as const,
    policy: "inherit_config" as const,
    supportedSystem: system,
    registryStorePath,
    policyAssertionStorePath: store(`${system}-${slot}`, "builder-policy"),
    probeFlakeStorePath: store(`${system}-${slot}`, "builder-probes"),
  };
}

function registry() {
  return {
    schema: "viberoots.reviewed-remote-builders.v3" as const,
    evidenceStore: {
      schema: "viberoots.reproducibility-evidence-store.v1" as const,
      storeUri: "s3://reviewed-evidence/reproducibility",
      signatures: "required" as const,
    },
    builders: RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
      (["a", "b"] as const).map((slot) => {
        const builder = authority(system, slot);
        return {
          identity: builder.identity,
          endpoint: {
            schema: "viberoots.remote-builder-endpoint.v2" as const,
            host: `${system.replaceAll("_", "-")}-${slot}.example.test`,
            port: 22,
            protocol: "ssh-ng" as const,
            user: "nix",
            hostKey: deterministicRemoteBuilderHostKey(`${system}:${slot}`),
          },
          supportedSystem: system,
          policyStorePath: builder.policyAssertionStorePath,
          probeFlakeStorePath: builder.probeFlakeStorePath,
        };
      }),
    ).sort((left, right) => left.identity.localeCompare(right.identity)),
  };
}

function evidence(
  subject: ArtifactReproducibilityEvidence["subjectAuthority"],
  system: (typeof RELEASE_BUILDER_SYSTEMS)[number],
  slot: "a" | "b",
  index: number,
): ArtifactReproducibilityEvidence {
  const key = `${subject.kind}-${subject.kind === "matrix" ? subject.matrixId : subject.subjectId}-${system}`;
  const outputPath = store(key, key);
  const semanticManifest =
    subject.kind !== "matrix" || subject.artifactFamily !== "rust"
      ? ({ kind: "not-applicable" } as const)
      : subject.matrixId === "rust-tauri-darwin-pr12"
        ? ({
            kind: "tauri-artifact-manifest",
            storePath: `${outputPath}/share/viberoots-tauri/artifact-manifest.json`,
            digest: digest(`semantic-${key}`),
          } as const)
        : ({
            kind: "rust-materialization-manifest",
            storePath: `${outputPath}/share/viberoots-rust/materialization-manifest.json`,
            digest: digest(`semantic-${key}`),
          } as const);
  return {
    schema: "viberoots.artifact-reproducibility-evidence.v6",
    classification: "hermetic",
    sourceRevision: "a".repeat(40),
    toolSourceRevision: "b".repeat(40),
    immutableSourceDigest: digest("source"),
    evaluationBundleAuthority: {
      sourceRoot: `${store(`bundle-${index}`, "evaluation-bundle")}/source`,
      digest: digest(`bundle-${index}`),
      bindingDigest: digest(`binding-${index}`),
      replayMaterializations: 2,
    },
    declaredGraphDigest: digest("graph"),
    dependencyLockDigest: digest("locks"),
    toolClosureDigest: artifactToolClosureDigest(store("tools", "remote-ci-tools")),
    toolClosureRoot: store("tools", "remote-ci-tools"),
    system,
    derivationPath: store(key, `${key}.drv`),
    outputPath,
    provenanceOutputPath: outputPath,
    narHash: digest(`nar-${key}`),
    provenanceNarHash: digest(`nar-${key}`),
    closureIdentityDigest: digest(`closure-${key}`),
    provenanceClosureIdentityDigest: digest(`closure-${key}`),
    semanticManifest,
    subjectAuthority: subject,
    checkoutIdentity: digest(`checkout-${system}-${slot}`),
    builderAuthority: authority(system, slot),
    forcedRebuild: true,
    warmIdentityStable: true,
  };
}

export function signedCacheAggregateFixture(): SignedArtifactReproducibilityAggregate {
  const subjects: ArtifactReproducibilityEvidence["subjectAuthority"][] = [
    ...ARTIFACT_REPRODUCIBILITY_MATRIX.map((matrixCase, index) => ({
      kind: "matrix" as const,
      matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
      matrixId: matrixCase.id,
      artifactFamily: matrixCase.artifactFamily,
      recipeDigest: reproducibilityRecipeDigest(matrixCase.id),
      bindingDigest: digest(`binding-${index}`),
      target: matrixCase.graphSelection.target,
    })),
    productionPublicationSubject,
  ];
  const records = subjects.flatMap((subject, index) =>
    (subject.kind === "matrix"
      ? reproducibilityMatrixCase(subject.matrixId).systems
      : RELEASE_BUILDER_SYSTEMS
    ).flatMap((system) =>
      (["a", "b"] as const).map((slot) => {
        const artifactEvidence = evidence(
          subject,
          system as (typeof RELEASE_BUILDER_SYSTEMS)[number],
          slot,
          index,
        );
        return createArtifactReproducibilityRunRecord({
          registryStorePath,
          observationStorePath: observationStorePath(artifactEvidence),
          evidence: artifactEvidence,
        });
      }),
    ),
  );
  return {
    storePath: `/nix/store/${"a".repeat(32)}-aggregate/aggregate.json`,
    aggregate: aggregateArtifactReproducibilityEvidence({
      registry: registry(),
      registryStorePath,
      publicationSubjects: [productionPublicationSubject],
      records,
      observations: artifactObservationsForRecords(records),
      languageManifest: graduatedLanguageManifestFixture,
      expectedSourceRevision: "a".repeat(40),
      expectedToolClosureRoot: store("tools", "remote-ci-tools"),
      expectedToolClosureSourceIdentity: toolClosureSourceIdentity,
      protectedRustPatchEvidence: RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
        (["a", "b"] as const).map((slot, index) =>
          createProtectedRustPatchEvidence({
            sourceRevision: "a".repeat(40),
            toolSourceRevision: "b".repeat(40),
            system,
            builderSlot: index === 0 ? "one" : "two",
            builderAuthority: authority(system, slot),
            remoteStoreRequired: true,
            toolClosureSourceIdentity,
            cases: protectedRustPatchCaseDefinitions(system).map((testCase, caseIndex) => {
              const baseline = protectedPatchPhase(testCase, system, caseIndex, "baseline");
              return {
                caseId: testCase.id,
                driverSource: `${store("tools", "remote-ci-tools")}/share/viberoots-source/build-tools/tools/ci/protected-rust-patch-case-driver.ts`,
                workflowSource: `${store("tools", "remote-ci-tools")}/share/viberoots-source/build-tools/tools/patch/patch-rust.ts`,
                workflowActions: ["start", "apply", "remove"] as ["start", "apply", "remove"],
                patchPath: `${testCase.cargoRoot}/patches/rust/dependency.patch`,
                baseline,
                patched: protectedPatchPhase(testCase, system, caseIndex, "patched"),
                restored: protectedPatchPhase(testCase, system, caseIndex, "restored"),
              };
            }),
          }),
        ),
      ),
    }),
    evidenceStoreUri: "s3://reviewed-evidence/reproducibility",
  };
}

function protectedPatchPhase(
  testCase: ReturnType<typeof protectedRustPatchCaseDefinitions>[number],
  system: string,
  caseIndex: number,
  phase: string,
) {
  const state = phase === "patched" ? "patched" : "baseline";
  const outputPath = store(`${system}-${caseIndex}-${state}`, state);
  const reachableNodes = testCase.matrixCase.languageProofs.map((proof) => ({
    name: proof.target,
    ruleType: proof.ruleTypes[0]!,
    kinds: proof.requiredLabels.filter((label) => label.startsWith("kind:")),
  }));
  return {
    derivationPaths: [`${outputPath}.drv`],
    outputPaths: [outputPath],
    semanticDigest: digest(`${outputPath}:semantic`),
    behaviorDigest: digest(`${outputPath}:behavior`),
    behavior: state === "patched" ? "43" : "42",
    graphDigest: digest(`${system}:${caseIndex}:${state}:graph`),
    graphBindingDigest: digest(`${system}:${caseIndex}:binding`),
    matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
    evaluationBundleDigest: digest(`${system}:${caseIndex}:${state}:bundle`),
    sourceTreeDigest: `sha256-${Buffer.from(`${system}:${caseIndex}:${state}`).toString("base64")}`,
    consumerCommit: digest(`${system}:${caseIndex}:${phase}:commit`).slice(7, 47),
    consumerTree: digest(`${system}:${caseIndex}:${state}:tree`).slice(7, 47),
    patchDigest: state === "patched" ? digest(`${system}:${caseIndex}:patch`) : null,
    reachableNodes,
    reachableNodesDigest: `sha256:${crypto
      .createHash("sha256")
      .update(JSON.stringify(reachableNodes))
      .digest("hex")}`,
  };
}
