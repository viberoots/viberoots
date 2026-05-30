import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import {
  awsTopologyRequiredCapabilityIds,
  validateAwsTopologyEvidence,
} from "./cloud-control-aws-topology-validate";

export function validateAwsCutoverTopology(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  return validateAwsTopologyEvidence(evidence.awsTopology, {
    expectedRegion: options.expectedRegion,
    maxAgeMinutes: options.maxAgeMinutes,
    selectedCapabilityIds: options.selectedCapabilities,
  });
}

export function requiredAwsProviderCapabilities(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  return awsTopologyRequiredCapabilityIds(evidence.awsTopology);
}
