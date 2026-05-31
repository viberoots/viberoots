import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import {
  awsTopologyRequiredCapabilityIds,
  validateAwsTopologyEvidence,
} from "./cloud-control-aws-topology-validate";
import { validateIngressCommandEvidenceBundle } from "./cloud-control-aws-ingress-command-evidence";

export function validateAwsCutoverTopology(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  const latestPublicUrl = String(evidence.latestNonProductionDeployment?.publicUrl || "");
  const expectedPublicUrl = String(evidence.runtimeConfig?.publicUrl || "");
  const callback = (evidence.runtimeConfig?.authProvider as any)?.callback || {};
  const expectedAuthCallbackHost = String(callback.externalHost || "");
  const expectedAuthCallbackPath = String(callback.externalPath || "");
  const required = [];
  if (!latestPublicUrl) {
    required.push("AWS cutover requires latest deployment publicUrl evidence");
  }
  if (!expectedPublicUrl) required.push("AWS cutover requires runtime publicUrl evidence");
  if (latestPublicUrl && expectedPublicUrl && latestPublicUrl !== expectedPublicUrl) {
    required.push("AWS cutover latest deployment publicUrl does not match runtime publicUrl");
  }
  if (!expectedAuthCallbackHost) {
    required.push("AWS cutover requires runtime auth-provider callback host evidence");
  }
  if (!expectedAuthCallbackPath) {
    required.push("AWS cutover requires runtime auth-provider callback path evidence");
  }
  const topologyOptions = {
    expectedRegion: options.expectedRegion,
    maxAgeMinutes: options.maxAgeMinutes,
    selectedCapabilityIds: options.selectedCapabilities,
    expectedImage: String(evidence.latestNonProductionDeployment?.image || ""),
    expectedImageDigest: String(evidence.imagePublication?.digest || ""),
    expectedPublicUrl,
    expectedAuthCallbackHost,
    expectedAuthCallbackPath,
  };
  return [
    ...validateAwsTopologyEvidence(evidence.awsTopology, topologyOptions),
    ...validateIngressCommandEvidenceBundle(evidence.awsTopology, evidence.ingressCommandEvidence, {
      ...topologyOptions,
      required: true,
    }),
    ...required,
  ];
}

export function requiredAwsProviderCapabilities(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  return awsTopologyRequiredCapabilityIds(evidence.awsTopology);
}
