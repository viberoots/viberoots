import type { ArtifactBuilderAuthority } from "../lib/artifact-reproducibility-evidence";
import type { ProtectedRustPatchCaseResult } from "./protected-rust-patch-case-driver";
import { protectedEvidenceDigest as digest } from "./protected-rust-patch-evidence-utils";
import type { RemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";

export type ProtectedRustPatchEvidence = {
  schema: "viberoots.protected-rust-patch-evidence.v6";
  sourceRevision: string;
  toolSourceRevision: string;
  system: string;
  builderSlot: "one" | "two";
  builderAuthority: ArtifactBuilderAuthority;
  remoteStoreRequired: true;
  toolClosureSourceIdentity: RemoteCiToolsSourceIdentity;
  cases: ProtectedRustPatchCaseResult[];
  caseSetDigest: string;
  identityDigest: string;
};

export function createProtectedRustPatchEvidenceSchema(
  value: Omit<ProtectedRustPatchEvidence, "identityDigest" | "schema" | "caseSetDigest">,
): ProtectedRustPatchEvidence {
  const evidence = {
    schema: "viberoots.protected-rust-patch-evidence.v6" as const,
    ...value,
    caseSetDigest: digest(value.cases),
    identityDigest: "",
  };
  evidence.identityDigest = digest({ ...evidence, identityDigest: undefined });
  return evidence;
}
