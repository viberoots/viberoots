import crypto from "node:crypto";
import {
  aggregateArtifactReproducibilityEvidence,
  createArtifactReproducibilityRunRecord,
  type PublicationSubject,
} from "../../ci/artifact-reproducibility-aggregate";
import type { SignedArtifactReproducibilityAggregate } from "../../ci/cache-publication-evidence";
import {
  artifactToolClosureDigest,
  type ArtifactReproducibilityEvidence,
} from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";
import { deterministicRemoteBuilderHostKey } from "../remote-exec/remote-builder-host-key.fixture";
import {
  artifactObservationsForRecords,
  graduatedLanguageManifestFixture,
  observationStorePath,
} from "./artifact-reproducibility.fixture";

const registryStorePath = `/nix/store/${"9".repeat(32)}-registry/registry.json`;
const evidenceStoreUri = "s3://reviewed-evidence/reproducibility";
const digest = (value: string) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const store = (value: string, name: string) =>
  `/nix/store/${crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)}-${name}`;

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
      storeUri: evidenceStoreUri,
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
  return {
    schema: "viberoots.artifact-reproducibility-evidence.v4",
    classification: "hermetic",
    sourceRevision: "a".repeat(40),
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
    outputPath: store(key, key),
    narHash: digest(`nar-${key}`),
    closureIdentityDigest: digest(`closure-${key}`),
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
    RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
      (["a", "b"] as const).map((slot) => {
        const artifactEvidence = evidence(subject, system, slot, index);
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
    }),
    evidenceStoreUri,
  };
}
