import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import {
  validateCredentialRotationEvidence,
  validateCredentialStagingEvidence,
} from "./control-plane-credential-staging-evidence";

export function validateCredentialCutoverEvidence(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  return [
    ...validateCredentialStagingEvidence(evidence.credentialStaging, {
      manifestDigest: evidence.credentialManifestDigest,
      credentialMapDigest: evidence.credentialMapDigest,
      requiredFiles: evidence.credentialManifestRequiredFiles,
      maxAgeMinutes: options.maxAgeMinutes,
    }),
    ...validateCredentialRotationEvidence(evidence.credentialRotation, {
      manifestDigest: evidence.credentialManifestDigest,
      credentialMapDigest: evidence.credentialMapDigest,
      requiredFiles: evidence.credentialManifestRequiredFiles,
      maxAgeMinutes: options.maxAgeMinutes,
    }),
  ];
}
