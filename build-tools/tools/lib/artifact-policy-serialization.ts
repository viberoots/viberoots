import type { ArtifactPolicyEvidence } from "./artifact-build-policy";

export function serializeArtifactPolicyEvidence(evidence: ArtifactPolicyEvidence): string {
  return JSON.stringify(evidence);
}
