import {
  evidenceList,
  evidenceObject,
  evidenceSecretErrors,
  evidenceSourceErrors,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";
import type { AwsArtifactBackend } from "./cloud-control-aws-topology-types";
import {
  AWS_FOUNDATION_PRIVATELINK_REQUIRED_QUOTAS,
  AWS_FOUNDATION_PROFILE_SCHEMA,
  AWS_FOUNDATION_REQUIRED_EGRESS,
  AWS_FOUNDATION_REQUIRED_QUOTAS,
} from "./cloud-control-aws-foundation-types";

export function validateAwsFoundationProfile(
  value: unknown,
  options: EvidenceFreshnessOptions & {
    expectedRegion?: string;
    expectedAccountId?: string;
    expectedArtifactBackend?: AwsArtifactBackend;
    capabilityId?: string;
    requiresVpcLattice?: boolean;
  },
): string[] {
  const profile = evidenceObject(value);
  if (Object.keys(profile).length === 0) return ["AWS foundation profile is missing"];
  const errors = [
    ...validateCore(profile, options),
    ...validateState(profile.state, options),
    ...validateTags(profile.tags),
    ...validatePreflight(profile.preflight, options),
    ...validateNetwork(profile.network),
    ...validateIam(profile.iam),
    ...validateArtifactStore(profile.artifactStore, options),
    ...evidenceSourceErrors(profile, "awsFoundation"),
    ...evidenceSecretErrors(profile, "awsFoundation"),
  ];
  if (
    options.capabilityId &&
    !evidenceList(profile, "capabilityIds").includes(options.capabilityId)
  ) {
    errors.push(`AWS foundation profile is not bound to ${options.capabilityId}`);
  }
  return errors;
}

function validateCore(
  profile: Record<string, unknown>,
  options: Parameters<typeof validateAwsFoundationProfile>[1],
) {
  const errors: string[] = [];
  if (profile.schemaVersion !== AWS_FOUNDATION_PROFILE_SCHEMA)
    errors.push("AWS foundation profile has unsupported schemaVersion");
  if (
    !["aws-provider-inspection", "opentofu-apply-output", "imported-reviewed-evidence"].includes(
      evidenceText(profile, "source"),
    )
  )
    errors.push("AWS foundation profile source must be provider inspection or reviewed IaC output");
  if (!freshEvidenceAt(profile, options)) errors.push("AWS foundation profile is missing or stale");
  const accountId = evidenceText(profile, "accountId");
  const region = evidenceText(profile, "region");
  if (!/^\d{12}$/.test(accountId))
    errors.push("AWS foundation profile account id is missing or invalid");
  if (options.expectedAccountId && accountId !== options.expectedAccountId)
    errors.push("AWS foundation profile account id does not match topology");
  if (options.expectedRegion && region !== options.expectedRegion)
    errors.push("AWS foundation profile region does not match topology");
  if (!["aws", "aws-us-gov", "aws-cn"].includes(evidenceText(profile, "partition")))
    errors.push("AWS foundation profile partition is unsupported");
  return errors;
}

function validateState(value: unknown, options: EvidenceFreshnessOptions): string[] {
  const state = evidenceObject(value);
  const drift = evidenceObject(state.drift);
  const errors: string[] = [];
  if (state.backend !== "s3") errors.push("AWS IaC state backend must be repo-owned encrypted S3");
  if (state.encrypted !== true) errors.push("AWS IaC state must be encrypted");
  if (!["dynamodb", "s3-native"].includes(evidenceText(state, "lock")))
    errors.push("AWS IaC state lock is missing");
  if (!evidenceText(state, "workspace")) errors.push("AWS IaC workspace naming is missing");
  if (!freshEvidenceAt(drift, options) || drift.status !== "in-sync")
    errors.push("AWS drift evidence is missing, stale, or not clean");
  if (!evidenceText(drift, "diffDigest").startsWith("sha256:"))
    errors.push("AWS drift evidence missing diff digest");
  return errors;
}

function validateTags(value: unknown): string[] {
  const tags = evidenceObject(value);
  return ["owner", "environment", "dataClassification", "rollback"].flatMap((name) =>
    evidenceText(tags, name) ? [] : [`AWS mandatory tag ${name} is missing`],
  );
}
function validatePreflight(value: unknown, options: EvidenceFreshnessOptions): string[] {
  const preflight = evidenceObject(value);
  const quotas = Array.isArray(preflight.quotas) ? preflight.quotas.map(evidenceObject) : [];
  const required = [
    ...AWS_FOUNDATION_REQUIRED_QUOTAS,
    ...(options.requiresVpcLattice ? AWS_FOUNDATION_PRIVATELINK_REQUIRED_QUOTAS : []),
  ];
  const errors = required.flatMap((service) =>
    sufficientQuota(quotas, service)
      ? []
      : [`AWS quota preflight missing sufficient ${service} quota`],
  );
  const cost = evidenceObject(preflight.costEstimate);
  if (!freshEvidenceAt(cost, options) || !evidenceText(cost, "approvedRef"))
    errors.push("AWS cost estimate evidence is missing or stale");
  const kms = evidenceObject(preflight.kms);
  if (kms.selected === true && (!evidenceText(kms, "keyArn") || Number(kms.deletionWindowDays) < 7))
    errors.push("AWS KMS evidence missing key ownership or deletion-window posture");
  return errors;
}

function validateNetwork(value: unknown): string[] {
  const network = evidenceObject(value);
  const errors: string[] = [];
  if (!["create", "import"].includes(evidenceText(evidenceObject(network.vpc), "mode")))
    errors.push("AWS VPC profile must declare create or import mode");
  if (!/^vpc-[a-z0-9]+$/i.test(evidenceText(evidenceObject(network.vpc), "vpcId")))
    errors.push("AWS VPC profile missing VPC id");
  if (evidenceList(network, "privateSubnetIds").length < 2)
    errors.push("AWS foundation requires private subnets in at least two Availability Zones");
  const privateSubnets = Array.isArray(network.privateSubnets)
    ? network.privateSubnets.map(evidenceObject)
    : evidenceList(network, "privateSubnetIds").map((id) => ({ id }));
  for (const [index, subnet] of privateSubnets.entries()) {
    if (subnet.mapPublicIpOnLaunch === true)
      errors.push(`AWS foundation private subnet ${index} must not map public IPs`);
    if (evidenceText(subnet, "vpcId") !== evidenceText(evidenceObject(network.vpc), "vpcId")) {
      errors.push(`AWS foundation private subnet ${index} VPC does not match foundation VPC`);
    }
  }
  if (evidenceList(network, "availabilityZones").length < 2)
    errors.push("AWS foundation requires at least two Availability Zones");
  if (evidenceList(network, "routeTableIds").length === 0)
    errors.push("AWS route-table profile is missing");
  if (evidenceList(network, "natGatewayIds").length === 0)
    errors.push("AWS NAT gateway profile is missing");
  if (!evidenceText(network, "internetGatewayId").startsWith("igw-"))
    errors.push("AWS internet gateway profile is missing");
  const s3Endpoint = evidenceObject(network.s3VpcEndpoint);
  if (
    !evidenceText(s3Endpoint, "endpointId").startsWith("vpce-") ||
    !evidenceText(s3Endpoint, "endpointPolicyDigest").startsWith("sha256:")
  )
    errors.push("AWS S3 VPC endpoint identity or policy evidence is missing");
  for (const target of AWS_FOUNDATION_REQUIRED_EGRESS)
    if (!evidenceList(network, "outboundHttpsTargets").includes(target))
      errors.push(`AWS egress policy missing ${target}`);
  const outboundDigests = evidenceObject(network.outboundPolicyDigests);
  for (const target of AWS_FOUNDATION_REQUIRED_EGRESS)
    if (!evidenceText(outboundDigests, target).startsWith("sha256:"))
      errors.push(`AWS egress policy ${target} missing reviewed digest`);
  for (const target of evidenceList(network, "outboundHttpsTargets"))
    if (target === "*" || target === "0.0.0.0/0")
      errors.push("AWS worker egress policy must not allow undocumented broad outbound access");
  for (const name of ["service", "worker", "loadBalancer", "s3Endpoint", "privatelink"])
    if (!evidenceText(network.securityGroupIds, name))
      errors.push(`AWS security group ${name} is missing`);
  return errors;
}

function validateIam(value: unknown): string[] {
  const iam = evidenceObject(value);
  const errors: string[] = [];
  for (const name of ["ec2Host", "s3ArtifactAccess", "evidenceCollector", "providerHook"])
    if (!evidenceText(iam.roles, name)) errors.push(`AWS IAM role ${name} is missing`);
  if (!evidenceText(iam, "instanceProfileTrustDigest").startsWith("sha256:"))
    errors.push("AWS instance profile trust evidence missing digest");
  const policies = Array.isArray(iam.policies) ? iam.policies.map(evidenceObject) : [];
  for (const policy of policies) {
    const actions = evidenceList(policy, "actions");
    if (!evidenceText(policy, "digest").startsWith("sha256:"))
      errors.push(`AWS IAM policy ${evidenceText(policy, "name") || "<missing>"} missing digest`);
    if (policy.leastPrivilege !== true || actions.some((action) => action.includes("*")))
      errors.push(`AWS IAM policy ${evidenceText(policy, "name") || "<missing>"} is over-broad`);
  }
  if (policies.length === 0) errors.push("AWS IAM policy evidence is missing");
  return errors;
}

function validateArtifactStore(
  value: unknown,
  options: Parameters<typeof validateAwsFoundationProfile>[1],
): string[] {
  const store = evidenceObject(value);
  const backend = evidenceText(store, "backend") as AwsArtifactBackend;
  const errors: string[] = [];
  if (options.expectedArtifactBackend && backend !== options.expectedArtifactBackend)
    errors.push("AWS foundation artifact backend does not match selected topology backend");
  if (store.publicAccessBlock !== true)
    errors.push("artifact store public-access block evidence is missing");
  if (store.versioning !== true) errors.push("artifact store versioning evidence is missing");
  if (store.lifecycle !== true) errors.push("artifact store lifecycle evidence is missing");
  if (store.objectLock !== true && store.retention === "object-lock")
    errors.push("artifact store object-lock evidence is missing");
  if (store.immutablePrefix !== true)
    errors.push("artifact store immutable prefix policy is missing");
  if (
    store.immutablePrefix === true &&
    !evidenceText(store, "immutablePrefixPolicyDigest").startsWith("sha256:")
  )
    errors.push("artifact store immutable prefix policy missing digest");
  if (
    store.replicationSelected === true &&
    (!evidenceText(store.replicationEvidence, "reviewedReference") ||
      !evidenceText(store.replicationEvidence, "digest").startsWith("sha256:"))
  )
    errors.push("artifact store replication/import evidence is missing");
  if (
    backend === "aws-s3" &&
    (!evidenceText(store, "bucket") ||
      !evidenceText(store, "endpointPolicyDigest").startsWith("sha256:") ||
      !evidenceText(store, "bucketPolicyDigest").startsWith("sha256:"))
  )
    errors.push("AWS S3 artifact store missing bucket endpoint or bucket policy evidence");
  if (
    backend !== "aws-s3" &&
    (!evidenceText(store.importEvidence, "digest").startsWith("sha256:") ||
      !evidenceText(store.retentionEvidence, "digest").startsWith("sha256:") ||
      !evidenceText(store.networkPath, "digest").startsWith("sha256:") ||
      !["public-internet", "private-endpoint"].includes(
        evidenceText(store.networkPath, "expectation"),
      ) ||
      !completeAlternateCompatibility(store.compatibility))
  )
    errors.push(`${backend}: missing reviewed alternate artifact-store profile`);
  return errors;
}

function sufficientQuota(quotas: Record<string, unknown>[], service: string): boolean {
  return quotas.some(
    (item) =>
      evidenceText(item, "service") === service && Number(item.available) >= Number(item.required),
  );
}

function completeAlternateCompatibility(value: unknown): boolean {
  const compatibility = evidenceObject(value);
  return ["endpointShape", "signingRegion", "pathStyle", "metadata"].every((name) =>
    evidenceText(compatibility, name),
  );
}
