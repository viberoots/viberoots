import type { MetadataHandoffPatch } from "./infisical-iac-bootstrap-metadata-handoff";

export type TargetMetadataHandoff = {
  target: string;
  patch: MetadataHandoffPatch;
};

export function requireConsistentMetadataHandoffs(handoffs: TargetMetadataHandoff[]) {
  if (handoffs.length === 0) return undefined;
  const first = canonicalPatchPayload(handoffs[0].patch);
  const divergent = handoffs.filter((item) => canonicalPatchPayload(item.patch) !== first);
  if (divergent.length > 0) throw divergentPatchError(handoffs);
  return handoffs[0].patch;
}

function canonicalPatchPayload(patch: MetadataHandoffPatch) {
  return JSON.stringify({
    schemaVersion: patch.schemaVersion,
    path: patch.path,
    replacements: patch.replacements,
    unifiedDiff: patch.unifiedDiff,
  });
}

function divergentPatchError(handoffs: TargetMetadataHandoff[]) {
  return new Error(
    [
      "Deployment bootstrap fan-out produced divergent first-bootstrap metadata patches.",
      `Affected targets: ${handoffs.map((item) => item.target).join(", ")}`,
      "No reviewed metadata patch was applied. Inspect the target OpenTofu outputs before retrying.",
    ].join("\n"),
  );
}
