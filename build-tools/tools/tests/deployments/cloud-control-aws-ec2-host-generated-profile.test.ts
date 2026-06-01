#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { awsEc2HookProfile } from "./cloud-control-aws-ec2-hook-profile.fixture";

test("EC2 host hook rejects missing generated profile identity anchors", async () => {
  for (const [profileOverrides, pattern] of [
    [
      { compute: { instanceId: "", autoScalingGroupName: "" } },
      /generated profile missing instance or ASG identity/,
    ],
    [
      { compute: { instanceId: "", launchTemplateId: "", launchTemplateVersion: "" } },
      /generated profile missing launch-template or instance identity/,
    ],
    [{ compute: { amiId: "" } }, /generated profile missing amiId/],
    [{ compute: { amiPinPath: "" } }, /generated profile missing amiPinPath/],
    [{ compute: { instanceType: "" } }, /generated profile missing instanceType/],
    [{ compute: { instanceProfileArn: "" } }, /generated profile missing instanceProfileArn/],
    [{ compute: { bootstrapDigest: "" } }, /generated profile missing bootstrapDigest/],
    [{ compute: { containerRuntime: "" } }, /generated profile missing containerRuntime/],
    [
      { compute: { selectedSubnetIds: [] } },
      /generated profile missing private subnet attachments/,
    ],
    [
      { compute: { securityGroupIds: [] }, network: { securityGroupIds: [] } },
      /generated profile missing security-group attachments/,
    ],
  ] as const) {
    await assert.rejects(
      runCloudProviderCapabilityHook({
        capabilityId: "aws-ec2-control-plane-host",
        phase: "evidence",
        deploymentLabel: "//deployments:staging",
        awsTopologyEvidence: publicAwsTopology(),
        awsEc2Profile: profileWith(profileOverrides),
      }),
      pattern,
    );
  }
});

function profileWith(overrides: Record<string, any>) {
  const profile = awsEc2HookProfile() as any;
  return {
    ...profile,
    ...overrides,
    compute: { ...profile.compute, ...(overrides.compute || {}) },
    network: { ...profile.network, ...(overrides.network || {}) },
  };
}
