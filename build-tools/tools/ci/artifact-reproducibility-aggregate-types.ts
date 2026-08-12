import type {
  ArtifactBuilderAuthority,
  ArtifactReproducibilityEvidence,
  ArtifactReproducibilitySubjectAuthority,
  artifactIdentityFields,
} from "../lib/artifact-reproducibility-evidence";
import type { ArtifactObservationSummary } from "./artifact-reproducibility-aggregate-gates";
import type { LanguageQualificationProof } from "./artifact-reproducibility-language-qualification";
import type { ProtectedRustPatchEvidence } from "./protected-rust-patch-evidence";
import type { RemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";

export type ArtifactReproducibilityIdentity = ReturnType<typeof artifactIdentityFields>;
export type PublicationSubject = Extract<
  ArtifactReproducibilitySubjectAuthority,
  { kind: "publication" }
>;
export type ArtifactReproducibilityComparison = {
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
  schema: "viberoots.artifact-reproducibility-aggregate.v6";
  sourceRevision: string;
  toolSourceRevision: string;
  matrixDigest: string;
  publicationSubjectSetDigest: string;
  registryStorePath: string;
  matrixComparisons: ArtifactReproducibilityComparison[];
  publicationComparisons: ArtifactReproducibilityComparison[];
  observationSummary: ArtifactObservationSummary;
  languageQualification: LanguageQualificationProof[];
  protectedRustPatchEvidence: ProtectedRustPatchEvidence[];
  toolClosureSourceIdentity: RemoteCiToolsSourceIdentity;
};
