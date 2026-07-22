import {
  artifactIdentityDigest,
  artifactIdentityFields,
  artifactToolClosureDigest,
  assertArtifactReproducibilityEvidence,
  type ArtifactBuilderAuthority,
  type ArtifactReproducibilityEvidence,
  type ArtifactReproducibilitySubjectAuthority,
} from "../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
} from "../lib/artifact-reproducibility-matrix";
import {
  assertIndependentReviewedRemoteBuilders,
  parseReviewedRemoteBuilders,
} from "../remote-exec/remote-builder-authority";
import { assertRegisteredArtifactBuilderAuthority } from "./artifact-reproducibility-aggregate-validation";
import {
  proveGraduatedLanguageCoverage,
  assertObservationStorePath,
  assertRunRecordAuthority,
  summarizeArtifactObservations,
  type ArtifactObservationSummary,
  type LanguageGraduationProof,
  type StoredArtifactObservation,
} from "./artifact-reproducibility-aggregate-gates";

export {
  assertArtifactReproducibilityAggregate,
  parseArtifactReproducibilityAggregate,
} from "./artifact-reproducibility-aggregate-validation";

export type ArtifactReproducibilityIdentity = ReturnType<typeof artifactIdentityFields>;
export type PublicationSubject = Extract<
  ArtifactReproducibilitySubjectAuthority,
  { kind: "publication" }
>;
type Comparison = {
  subjectId: string;
  system: string;
  artifactIdentity: ArtifactReproducibilityIdentity;
  artifactIdentityDigest: string;
  builderAuthorities: [ArtifactBuilderAuthority, ArtifactBuilderAuthority];
  checkoutIdentities: [string, string];
};

export type ArtifactReproducibilityRunRecord = {
  schema: "viberoots.artifact-reproducibility-run-record.v3";
  registryStorePath: string;
  observationStorePath: string;
  evidence: ArtifactReproducibilityEvidence;
};

export type ArtifactReproducibilityAggregate = {
  schema: "viberoots.artifact-reproducibility-aggregate.v3";
  sourceRevision: string;
  matrixDigest: string;
  publicationSubjectSetDigest: string;
  registryStorePath: string;
  matrixComparisons: Comparison[];
  publicationComparisons: Comparison[];
  observationSummary: ArtifactObservationSummary;
  languageGraduation: LanguageGraduationProof[];
};

export function createArtifactReproducibilityRunRecord(opts: {
  registryStorePath: string;
  observationStorePath: string;
  evidence: ArtifactReproducibilityEvidence;
}): ArtifactReproducibilityRunRecord {
  assertArtifactReproducibilityEvidence(opts.evidence);
  assertRegistryStorePath(opts.registryStorePath);
  if (opts.evidence.builderAuthority.registryStorePath !== opts.registryStorePath) {
    throw new Error("reproducibility evidence does not match its reviewed registry");
  }
  assertObservationStorePath(opts.observationStorePath);
  return {
    schema: "viberoots.artifact-reproducibility-run-record.v3",
    registryStorePath: opts.registryStorePath,
    observationStorePath: opts.observationStorePath,
    evidence: opts.evidence,
  };
}

export function aggregateArtifactReproducibilityEvidence(opts: {
  registry: unknown;
  registryStorePath: string;
  publicationSubjects: readonly PublicationSubject[];
  records: readonly ArtifactReproducibilityRunRecord[];
  observations: readonly StoredArtifactObservation[];
  languageManifest: unknown;
  expectedSourceRevision: string;
  expectedToolClosureRoot: string;
}): ArtifactReproducibilityAggregate {
  const registry = parseReviewedRemoteBuilders(opts.registry);
  assertRegistryStorePath(opts.registryStorePath);
  const builders = new Map(registry.builders.map((builder) => [builder.identity, builder]));
  const publicationSubjects = canonicalPublicationSubjects(opts.publicationSubjects);
  if (!/^[a-f0-9]{40,64}$/u.test(opts.expectedSourceRevision)) {
    throw new Error("reproducibility aggregate requires the protected source revision");
  }
  const expectedToolClosureDigest = artifactToolClosureDigest(opts.expectedToolClosureRoot);
  const expectedPublicationSubjects = new Map(
    publicationSubjects.map((subject) => [subject.subjectId, JSON.stringify(subject)]),
  );
  const expectedGroups =
    ARTIFACT_REPRODUCIBILITY_MATRIX.length * RELEASE_BUILDER_SYSTEMS.length +
    publicationSubjects.length * RELEASE_BUILDER_SYSTEMS.length;
  if (opts.records.length !== expectedGroups * 2) {
    throw new Error(`reproducibility aggregate requires exactly ${expectedGroups * 2} records`);
  }
  const groups = new Map<string, ArtifactReproducibilityRunRecord[]>();
  const publicationRevisions = new Set<string>();
  for (const record of opts.records) {
    assertRunRecordAuthority(record, opts.registryStorePath);
    const evidence = record.evidence;
    if (
      evidence.toolClosureRoot !== opts.expectedToolClosureRoot ||
      evidence.toolClosureDigest !== expectedToolClosureDigest
    ) {
      throw new Error("reproducibility evidence does not use the reviewed tool closure");
    }
    if (evidence.subjectAuthority.kind === "publication") {
      if (
        expectedPublicationSubjects.get(evidence.subjectAuthority.subjectId) !==
        JSON.stringify(evidence.subjectAuthority)
      ) {
        throw new Error(
          "publication record does not match the immutable production graph authority",
        );
      }
      if (evidence.sourceRevision !== opts.expectedSourceRevision) {
        throw new Error("publication evidence does not match the protected source revision");
      }
      publicationRevisions.add(evidence.sourceRevision);
    }
    const authority = evidence.builderAuthority;
    const registered = builders.get(authority.identity);
    if (!registered) throw new Error(`unregistered reproducibility builder: ${authority.identity}`);
    assertRegisteredArtifactBuilderAuthority(authority, registered, opts.registryStorePath);
    const key = subjectGroupKey(evidence.subjectAuthority, evidence.system);
    const group = groups.get(key) || [];
    if (
      group.some(({ evidence: prior }) => prior.builderAuthority.identity === authority.identity)
    ) {
      throw new Error(`duplicate reproducibility builder record for ${key}`);
    }
    group.push(record);
    groups.set(key, group);
  }
  if (publicationRevisions.size !== 1) {
    throw new Error("publication comparisons require one production source revision");
  }
  const matrixComparisons = ARTIFACT_REPRODUCIBILITY_MATRIX.flatMap((matrixCase) =>
    RELEASE_BUILDER_SYSTEMS.map((system) =>
      comparePair(groups, builders, `matrix:${matrixCase.id}\0${system}`, matrixCase.id, system),
    ),
  );
  const publicationComparisons = publicationSubjects.flatMap((subject) =>
    RELEASE_BUILDER_SYSTEMS.map((system) =>
      comparePair(
        groups,
        builders,
        `publication:${subject.subjectId}\0${system}`,
        subject.subjectId,
        system,
      ),
    ),
  );
  if (groups.size) throw new Error("reproducibility aggregate contains extra subject groups");
  const observationSummary = summarizeArtifactObservations(opts.records, opts.observations);
  const languageGraduation = proveGraduatedLanguageCoverage(
    opts.languageManifest,
    matrixComparisons,
  );
  return {
    schema: "viberoots.artifact-reproducibility-aggregate.v3",
    sourceRevision: [...publicationRevisions][0]!,
    matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
    publicationSubjectSetDigest: publicationSubjects[0]!.subjectSetDigest,
    registryStorePath: opts.registryStorePath,
    matrixComparisons,
    publicationComparisons,
    observationSummary,
    languageGraduation,
  };
}

function comparePair(
  groups: Map<string, ArtifactReproducibilityRunRecord[]>,
  builders: Map<string, ReturnType<typeof parseReviewedRemoteBuilders>["builders"][number]>,
  key: string,
  subjectId: string,
  system: string,
): Comparison {
  const pair = groups.get(key);
  if (!pair || pair.length !== 2) throw new Error(`two independent records required for ${key}`);
  groups.delete(key);
  const ordered = [...pair].sort((a, b) =>
    a.evidence.builderAuthority.identity.localeCompare(b.evidence.builderAuthority.identity),
  ) as [ArtifactReproducibilityRunRecord, ArtifactReproducibilityRunRecord];
  const [left, right] = ordered.map(({ evidence }) => evidence);
  if (left.checkoutIdentity === right.checkoutIdentity)
    throw new Error(`distinct checkouts required for ${key}`);
  assertIndependentReviewedRemoteBuilders(
    builders.get(left.builderAuthority.identity)!,
    builders.get(right.builderAuthority.identity)!,
  );
  const digest = artifactIdentityDigest(left);
  if (digest !== artifactIdentityDigest(right)) throw new Error(`builders disagree for ${key}`);
  return {
    subjectId,
    system,
    artifactIdentity: artifactIdentityFields(left),
    artifactIdentityDigest: digest,
    builderAuthorities: [left.builderAuthority, right.builderAuthority],
    checkoutIdentities: [left.checkoutIdentity, right.checkoutIdentity],
  };
}

function canonicalPublicationSubjects(
  subjects: readonly PublicationSubject[],
): PublicationSubject[] {
  if (!subjects.length) throw new Error("at least one production publication subject is required");
  const ordered = [...subjects].sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  const digest = ordered[0]!.subjectSetDigest;
  if (
    new Set(ordered.map(({ subjectId }) => subjectId)).size !== ordered.length ||
    ordered.some((subject) => subject.subjectSetDigest !== digest)
  ) {
    throw new Error("publication subject authority is duplicate or has inconsistent set identity");
  }
  return ordered;
}

function subjectGroupKey(subject: ArtifactReproducibilitySubjectAuthority, system: string): string {
  return `${subject.kind}:${subject.kind === "matrix" ? subject.matrixId : subject.subjectId}\0${system}`;
}

function assertRegistryStorePath(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(value)) {
    throw new Error("reviewed registry must be the canonical immutable registry.json");
  }
}
