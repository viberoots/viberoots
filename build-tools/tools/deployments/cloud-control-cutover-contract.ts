import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";

export function validateCutoverEvidenceContract(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const errors: string[] = [];
  const identity = evidence.operationIdentity || {};
  if (identity.operation !== options.operation) {
    errors.push("cutover evidence operation identity does not match requested operation");
  }
  if (!identity.sourceHost) errors.push("cutover evidence requires source host identity");
  if (!evidence.checkedAt) errors.push("cutover evidence requires checkedAt timestamp");
  if (!evidence.configDigest) errors.push("cutover evidence requires config digest");
  if (!evidence.credentialManifestDigest) {
    errors.push("cutover evidence requires credential manifest digest");
  }
  if (!evidence.imageDigest) errors.push("cutover evidence requires image digest");
  const latestImage = String(evidence.latestNonProductionDeployment?.image || "");
  if (evidence.imageDigest && latestImage && evidence.imageDigest !== latestImage) {
    errors.push("cutover evidence image digest does not match latest deployment image");
  }
  const selected = new Set(options.selectedCapabilities);
  const recorded = new Set(evidence.selectedProviderCapabilities || []);
  for (const id of selected) {
    if (!recorded.has(id)) errors.push(`${id}: not recorded as selected provider capability`);
  }
  return errors;
}
