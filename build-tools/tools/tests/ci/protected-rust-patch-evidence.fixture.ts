import { createProtectedRustPatchEvidence } from "../../ci/protected-rust-patch-evidence";

export function recreateProtectedPatchEvidence(
  evidence: ReturnType<typeof createProtectedRustPatchEvidence>,
) {
  return createProtectedRustPatchEvidence({
    sourceRevision: evidence.sourceRevision,
    toolSourceRevision: evidence.toolSourceRevision,
    system: evidence.system,
    builderSlot: evidence.builderSlot,
    builderAuthority: evidence.builderAuthority,
    remoteStoreRequired: true,
    toolClosureSourceIdentity: evidence.toolClosureSourceIdentity,
    cases: evidence.cases,
  });
}
