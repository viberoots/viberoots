import {
  artifactIdentityDigest,
  assertArtifactReproducibilityEvidence,
  type ArtifactBuilderAuthority,
  type ArtifactReproducibilityEvidence,
} from "../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  RELEASE_BUILDER_SYSTEMS,
  reproducibilityMatrixSystemPairs,
} from "../lib/artifact-reproducibility-matrix";
import {
  assertIndependentReviewedRemoteBuilders,
  parseReviewedRemoteBuilders,
  type ReviewedRemoteBuilderRegistry,
} from "../remote-exec/remote-builder-authority";
import type {
  ArtifactReproducibilityAggregate,
  PublicationSubject,
} from "./artifact-reproducibility-aggregate";
import { assertObservationSummary } from "./artifact-reproducibility-aggregate-gates";
import { assertLanguageQualificationProofs } from "./artifact-reproducibility-language-qualification";
import { assertProtectedRustPatchEvidenceSet } from "./protected-rust-patch-evidence";
import { assertRemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";

export function assertArtifactReproducibilityAggregate(opts: {
  aggregate: ArtifactReproducibilityAggregate;
  registry: unknown;
  registryStorePath: string;
  publicationSubjects?: readonly PublicationSubject[];
}): void {
  const registry = parseReviewedRemoteBuilders(opts.registry);
  const aggregate = opts.aggregate;
  exactAggregateKeys(aggregate, [
    "matrixComparisons",
    "matrixDigest",
    "languageQualification",
    "observationSummary",
    "publicationComparisons",
    "publicationSubjectSetDigest",
    "protectedRustPatchEvidence",
    "registryStorePath",
    "schema",
    "sourceRevision",
    "toolClosureSourceIdentity",
    "toolSourceRevision",
  ]);
  if (
    aggregate.schema !== "viberoots.artifact-reproducibility-aggregate.v6" ||
    aggregate.matrixDigest !== ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST ||
    aggregate.registryStorePath !== opts.registryStorePath
  )
    throw new Error("reproducibility aggregate authority does not match this release gate");
  if (!/^[a-f0-9]{40,64}$/u.test(aggregate.sourceRevision)) {
    throw new Error("reproducibility aggregate source revision is invalid");
  }
  assertRemoteCiToolsSourceIdentity(
    aggregate.toolClosureSourceIdentity,
    aggregate.toolSourceRevision,
  );
  const registered = new Map(registry.builders.map((builder) => [builder.identity, builder]));
  const matrixKeys = reproducibilityMatrixSystemPairs().map(
    ({ matrixId, system }) => `${matrixId}\0${system}`,
  );
  validateComparisons({
    comparisons: aggregate.matrixComparisons,
    expectedKeys: matrixKeys,
    kind: "matrix",
    toolSourceRevision: aggregate.toolSourceRevision,
    registered,
    registryStorePath: opts.registryStorePath,
  });
  assertObservationSummary(aggregate.observationSummary);
  assertLanguageQualificationProofs(aggregate.languageQualification, aggregate.matrixComparisons);
  assertProtectedRustPatchEvidenceSet({
    evidence: aggregate.protectedRustPatchEvidence,
    registry,
    registryStorePath: opts.registryStorePath,
    sourceRevision: aggregate.sourceRevision,
    toolSourceRevision: aggregate.toolSourceRevision,
    toolClosureSourceIdentity: aggregate.toolClosureSourceIdentity,
  });
  if (!aggregate.publicationComparisons.length) {
    throw new Error("reproducibility aggregate requires production publication comparisons");
  }
  const publicationIds = [
    ...new Set(aggregate.publicationComparisons.map(({ subjectId }) => subjectId)),
  ].sort();
  const publicationKeys = publicationIds.flatMap((id) =>
    RELEASE_BUILDER_SYSTEMS.map((system) => `${id}\0${system}`),
  );
  validateComparisons({
    comparisons: aggregate.publicationComparisons,
    expectedKeys: publicationKeys,
    kind: "publication",
    registered,
    registryStorePath: opts.registryStorePath,
    sourceRevision: aggregate.sourceRevision,
    toolSourceRevision: aggregate.toolSourceRevision,
  });
  for (const comparison of aggregate.publicationComparisons) {
    const subject = comparison.artifactIdentity.subjectAuthority;
    if (
      subject.kind !== "publication" ||
      subject.subjectSetDigest !== aggregate.publicationSubjectSetDigest
    ) {
      throw new Error("publication comparison has mismatched subject-set authority");
    }
  }
  if (opts.publicationSubjects)
    assertExpectedPublicationSubjects(aggregate, opts.publicationSubjects);
}

type Comparison = ArtifactReproducibilityAggregate["matrixComparisons"][number];
function validateComparisons(opts: {
  comparisons: Comparison[];
  expectedKeys: string[];
  kind: "matrix" | "publication";
  registered: Map<string, ReviewedRemoteBuilderRegistry["builders"][number]>;
  registryStorePath: string;
  sourceRevision?: string;
  toolSourceRevision?: string;
}): void {
  if (!Array.isArray(opts.comparisons) || opts.comparisons.length !== opts.expectedKeys.length) {
    throw new Error(`${opts.kind} comparisons do not have exact required coverage`);
  }
  for (const [index, comparison] of opts.comparisons.entries()) {
    exactAggregateKeys(comparison, [
      "artifactIdentity",
      "artifactIdentityDigest",
      "builderAuthorities",
      "checkoutIdentities",
      "subjectId",
      "system",
    ]);
    const key = `${comparison.subjectId}\0${comparison.system}`;
    if (key !== opts.expectedKeys[index])
      throw new Error(`${opts.kind} comparisons are not canonical`);
    if (
      comparison.builderAuthorities.length !== 2 ||
      comparison.checkoutIdentities.length !== 2 ||
      new Set(comparison.checkoutIdentities).size !== 2 ||
      new Set(comparison.builderAuthorities.map(({ identity }) => identity)).size !== 2
    ) {
      throw new Error(`${opts.kind} comparison lacks two independent authorities: ${key}`);
    }
    const reconstructed = {
      ...comparison.artifactIdentity,
      checkoutIdentity: comparison.checkoutIdentities[0]!,
      builderAuthority: comparison.builderAuthorities[0]!,
    } as ArtifactReproducibilityEvidence;
    assertArtifactReproducibilityEvidence(reconstructed);
    const subject = reconstructed.subjectAuthority;
    const id = subject.kind === "matrix" ? subject.matrixId : subject.subjectId;
    if (
      subject.kind !== opts.kind ||
      id !== comparison.subjectId ||
      reconstructed.system !== comparison.system ||
      (opts.kind === "publication" && reconstructed.sourceRevision !== opts.sourceRevision) ||
      reconstructed.toolSourceRevision !== opts.toolSourceRevision ||
      artifactIdentityDigest(reconstructed) !== comparison.artifactIdentityDigest
    ) {
      throw new Error(`${opts.kind} comparison identity does not match ${key}`);
    }
    validateBuilders(comparison, opts.registered, opts.registryStorePath);
  }
}

function validateBuilders(
  comparison: Comparison,
  registered: Map<string, ReviewedRemoteBuilderRegistry["builders"][number]>,
  registryStorePath: string,
): void {
  if (
    comparison.builderAuthorities[0].identity.localeCompare(
      comparison.builderAuthorities[1].identity,
    ) >= 0
  ) {
    throw new Error("comparison builders are not canonically ordered");
  }
  for (const authority of comparison.builderAuthorities) {
    const builder = registered.get(authority.identity);
    if (!builder) throw new Error(`unregistered aggregate builder: ${authority.identity}`);
    assertRegisteredArtifactBuilderAuthority(authority, builder, registryStorePath);
  }
  assertIndependentReviewedRemoteBuilders(
    registered.get(comparison.builderAuthorities[0].identity)!,
    registered.get(comparison.builderAuthorities[1].identity)!,
  );
}

function assertExpectedPublicationSubjects(
  aggregate: ArtifactReproducibilityAggregate,
  expected: readonly PublicationSubject[],
): void {
  const actual = new Map(
    aggregate.publicationComparisons.map((comparison) => {
      const subject = comparison.artifactIdentity.subjectAuthority as PublicationSubject;
      return [subject.subjectId, JSON.stringify(subject)];
    }),
  );
  if (
    actual.size !== expected.length ||
    expected.some((subject) => actual.get(subject.subjectId) !== JSON.stringify(subject))
  ) {
    throw new Error("signed publication subjects do not match the current production graph");
  }
}

export function parseArtifactReproducibilityAggregate(
  text: string,
  authority: {
    registry: unknown;
    registryStorePath: string;
    publicationSubjects?: readonly PublicationSubject[];
  },
): ArtifactReproducibilityAggregate {
  const aggregate = JSON.parse(text) as ArtifactReproducibilityAggregate;
  assertArtifactReproducibilityAggregate({ aggregate, ...authority });
  return aggregate;
}

export function assertRegisteredArtifactBuilderAuthority(
  authority: ArtifactBuilderAuthority,
  registered: ReviewedRemoteBuilderRegistry["builders"][number],
  registryStorePath: string,
): void {
  if (
    authority.supportedSystem !== registered.supportedSystem ||
    authority.registryStorePath !== registryStorePath ||
    authority.policyAssertionStorePath !== registered.policyStorePath ||
    authority.probeFlakeStorePath !== registered.probeFlakeStorePath
  ) {
    throw new Error(
      `reproducibility builder authority drifted from registry: ${authority.identity}`,
    );
  }
}

export function exactAggregateKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`reproducibility aggregate has invalid fields: ${actual.join(", ")}`);
  }
}
