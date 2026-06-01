import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";

export const AWS_EC2_HOST_HOOK_PAYLOAD_SCHEMA = "aws-ec2-host-hook-payload@1" as const;

export type AwsEc2HostPayloadValidationOptions = {
  expectedAwsTopology?: unknown;
};

export function validateAwsEc2HostProviderPayload(
  id: string,
  value: Record<string, unknown>,
  opts: AwsEc2HostPayloadValidationOptions = {},
): string[] {
  if (id !== "aws-ec2-control-plane-host") return [];
  const payload = evidenceObject(value.providerPayload);
  const identity = evidenceObject(payload.identity);
  const profile = evidenceObject(payload.generatedProfile);
  const operation = evidenceObject(payload.operation);
  const rollback = evidenceObject(payload.rollback);
  const errors: string[] = [];
  if (payload.schemaVersion !== AWS_EC2_HOST_HOOK_PAYLOAD_SCHEMA) {
    errors.push(`${id}: missing AWS EC2 host provider payload`);
  }
  if (payload.provisioningBoundary !== "non-mutating-structured-ec2-host-adapter") {
    errors.push(`${id}: AWS EC2 host payload boundary is unsupported`);
  }
  if (operation.mutationAuthority !== false || operation.executed !== false) {
    errors.push(`${id}: AWS EC2 host fixture hook must be non-mutating by default`);
  }
  for (const field of [
    "accountId",
    "region",
    "computeMode",
    "amiId",
    "amiPinPath",
    "instanceType",
    "instanceProfileArn",
    "bootstrapDigest",
    "containerRuntime",
    "credentialMountMode",
  ]) {
    if (!evidenceText(identity, field)) errors.push(`${id}: EC2 payload missing ${field}`);
  }
  if (!instanceOrAsg(identity)) errors.push(`${id}: EC2 payload missing instance or ASG identity`);
  if (!launchTemplateOrInstance(identity)) {
    errors.push(`${id}: EC2 payload missing launch-template or instance identity`);
  }
  if (evidenceList(identity, "privateSubnetIds").length === 0) {
    errors.push(`${id}: EC2 payload missing private subnet attachments`);
  }
  if (evidenceList(identity, "securityGroupIds").length === 0) {
    errors.push(`${id}: EC2 payload missing security-group attachments`);
  }
  if (profile.credentialMountMode !== identity.credentialMountMode) {
    errors.push(`${id}: EC2 payload profile credential mount mismatch`);
  }
  errors.push(...validateGeneratedProfile(id, identity, profile));
  if (String(value.phase || "") === "smoke" && payload.smokeEvidence !== true) {
    errors.push(`${id}: missing smoke evidence`);
  }
  if (
    rollback.nonDestructive !== true ||
    !Array.isArray(rollback.proofRefs) ||
    rollback.proofRefs.length === 0
  ) {
    errors.push(`${id}: EC2 rollback evidence shape drift`);
  }
  errors.push(...validateExpectedTopology(id, identity, opts.expectedAwsTopology));
  return errors;
}

function validateGeneratedProfile(
  id: string,
  identity: Record<string, unknown>,
  profile: Record<string, unknown>,
): string[] {
  const compute = evidenceObject(profile.compute);
  const network = evidenceObject(profile.network);
  const errors: string[] = [];
  for (const field of [
    "amiId",
    "amiPinPath",
    "instanceType",
    "instanceProfileArn",
    "bootstrapDigest",
    "containerRuntime",
  ]) {
    if (!evidenceText(compute, field)) {
      errors.push(`${id}: EC2 generated profile missing ${field}`);
    }
  }
  if (!instanceOrAsg(compute)) {
    errors.push(`${id}: EC2 generated profile missing instance or ASG identity`);
  }
  if (!launchTemplateOrInstance(compute)) {
    errors.push(`${id}: EC2 generated profile missing launch-template or instance identity`);
  }
  for (const [profileField, identityField] of [
    ["amiId", "amiId"],
    ["amiPinPath", "amiPinPath"],
    ["instanceType", "instanceType"],
    ["instanceProfileArn", "instanceProfileArn"],
    ["instanceId", "instanceId"],
    ["autoScalingGroupName", "autoScalingGroupName"],
    ["launchTemplateId", "launchTemplateId"],
    ["launchTemplateVersion", "launchTemplateVersion"],
    ["bootstrapDigest", "bootstrapDigest"],
    ["containerRuntime", "containerRuntime"],
  ] as const) {
    const expected = evidenceText(compute, profileField);
    if (expected && evidenceText(identity, identityField) !== expected) {
      errors.push(`${id}: EC2 payload ${identityField} does not match generated profile`);
    }
  }
  const profileSubnets = evidenceList(compute, "selectedSubnetIds");
  if (profileSubnets.length === 0) {
    errors.push(`${id}: EC2 generated profile missing private subnet attachments`);
  } else if (!sameStringSet(evidenceList(identity, "privateSubnetIds"), profileSubnets)) {
    errors.push(`${id}: EC2 payload privateSubnetIds do not match generated profile`);
  }
  const computeGroups = evidenceList(compute, "securityGroupIds");
  const profileGroups =
    computeGroups.length > 0 ? computeGroups : evidenceList(network, "securityGroupIds");
  if (profileGroups.length === 0) {
    errors.push(`${id}: EC2 generated profile missing security-group attachments`);
  } else if (!sameStringSet(evidenceList(identity, "securityGroupIds"), profileGroups)) {
    errors.push(`${id}: EC2 payload securityGroupIds do not match generated profile`);
  }
  return errors;
}

function instanceOrAsg(identity: Record<string, unknown>): boolean {
  return Boolean(
    evidenceText(identity, "instanceId") || evidenceText(identity, "autoScalingGroupName"),
  );
}

function launchTemplateOrInstance(identity: Record<string, unknown>): boolean {
  if (evidenceText(identity, "instanceId")) return true;
  return Boolean(
    evidenceText(identity, "launchTemplateId") && evidenceText(identity, "launchTemplateVersion"),
  );
}

function validateExpectedTopology(
  id: string,
  identity: Record<string, unknown>,
  expected: unknown,
): string[] {
  if (!expected) return [];
  const topology = evidenceObject(expected);
  const compute = evidenceObject(topology.compute);
  const errors: string[] = [];
  for (const field of [
    "accountId",
    "region",
    "amiId",
    "instanceType",
    "instanceProfileArn",
    "launchTemplateId",
    "launchTemplateVersion",
    "instanceId",
    "autoScalingGroupName",
  ]) {
    const expectedValue =
      field === "accountId" || field === "region"
        ? evidenceText(topology, field)
        : evidenceText(compute, field);
    if (expectedValue && evidenceText(identity, field) !== expectedValue) {
      errors.push(`${id}: EC2 payload ${field} does not match selected topology`);
    }
  }
  const expectedSubnets =
    evidenceList(compute, "launchTemplateSubnetIds").length > 0
      ? evidenceList(compute, "launchTemplateSubnetIds")
      : evidenceList(compute, "autoScalingGroupSubnetIds");
  if (
    expectedSubnets.length > 0 &&
    !sameStringSet(evidenceList(identity, "privateSubnetIds"), expectedSubnets)
  ) {
    errors.push(`${id}: EC2 payload privateSubnetIds do not match selected topology`);
  }
  const expectedGroups = evidenceList(compute, "securityGroupIds");
  if (
    expectedGroups.length > 0 &&
    !sameStringSet(evidenceList(identity, "securityGroupIds"), expectedGroups)
  ) {
    errors.push(`${id}: EC2 payload securityGroupIds do not match selected topology`);
  }
  return errors;
}

function sameStringSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((value) => actualSet.has(value));
}
