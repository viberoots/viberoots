import {
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";
import {
  hasReviewedEvidence,
  requireDigest,
  requireFresh,
} from "./cloud-control-aws-ingress-helpers";

export function validateImportedIngressEvidence(
  value: unknown,
  label: string,
  options: EvidenceFreshnessOptions & {
    capabilityId: string;
    accountId?: string;
    region?: string;
    vpcId?: string;
    loadBalancerArn?: string;
    hostname?: string;
  },
): string[] {
  if (!value) return [];
  const evidence = evidenceObject(value);
  const drift = evidenceObject(evidence.drift);
  const errors = [
    ...requireFresh(evidence, `${label} imported`, options),
    ...requireFresh(drift, `${label} drift`, options),
    ...requireDigest(evidence, `${label} imported evidence`),
  ];
  if (!hasReviewedEvidence(evidence)) {
    errors.push(`${label} imported evidence missing reviewed provenance`);
  }
  if (!evidenceText(evidence, "owner")) errors.push(`${label} imported evidence missing owner`);
  if (evidenceText(evidence, "capabilityId") !== options.capabilityId) {
    errors.push(`${label} imported evidence attached to wrong capability`);
  }
  if (drift.status !== "in-sync" || !evidenceText(drift, "diffDigest").startsWith("sha256:")) {
    errors.push(`${label} imported evidence drift is missing, stale, or dirty`);
  }
  for (const [field, expected] of Object.entries(topologyIdentity(options))) {
    if (expected && evidenceText(evidence, field) && evidenceText(evidence, field) !== expected) {
      errors.push(`${label} imported evidence ${field} does not match selected topology`);
    }
  }
  if (!freshEvidenceAt(evidence, options)) errors.push(`${label} imported evidence is stale`);
  return errors;
}

function topologyIdentity(options: {
  accountId?: string;
  region?: string;
  vpcId?: string;
  loadBalancerArn?: string;
  hostname?: string;
}): Record<string, string | undefined> {
  return {
    accountId: options.accountId,
    region: options.region,
    vpcId: options.vpcId,
    loadBalancerArn: options.loadBalancerArn,
    hostname: options.hostname,
  };
}
