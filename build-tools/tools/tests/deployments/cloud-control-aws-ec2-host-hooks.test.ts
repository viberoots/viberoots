#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES } from "../../deployments/cloud-control-provider-capability-hooks";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { awsEc2HookProfile } from "./cloud-control-aws-ec2-hook-profile.fixture";

test("EC2 host hook emits typed non-mutating payload for every phase", async () => {
  for (const phase of CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES) {
    const hook = await hookEvidence(phase);
    const payload = hook.providerPayload as any;
    assert.equal(payload.schemaVersion, "aws-ec2-host-hook-payload@1");
    assert.equal(payload.provisioningBoundary, "non-mutating-structured-ec2-host-adapter");
    assert.equal(payload.operation.mutationAuthority, false);
    assert.equal(payload.operation.executed, false);
    assert.equal(payload.identity.instanceType, "m7i.large");
    assert.equal(payload.identity.credentialMountMode, "bind-mounted-credential-directory");
    assert.equal(payload.smokeEvidence, phase === "smoke");
  }
});

test("EC2 host payload validation rejects profile and topology drift", async () => {
  const hook = await hookEvidence("evidence");
  for (const [overrides, pattern] of [
    [{ instanceType: "t3.micro" }, /EC2 payload instanceType does not match selected topology/],
    [
      { instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/unreviewed" },
      /EC2 payload instanceProfileArn does not match selected topology/,
    ],
    [
      { privateSubnetIds: ["subnet-unreviewed"] },
      /EC2 payload privateSubnetIds do not match selected topology/,
    ],
    [
      { securityGroupIds: ["sg-unreviewed"] },
      /EC2 payload securityGroupIds do not match selected topology/,
    ],
  ] as const) {
    assert.match(
      validateProviderCapabilityEvidence(
        [hook.declaration],
        {
          [hook.capabilityId]: withIdentity(hook, overrides),
        },
        { awsTopology: publicAwsTopology() },
      ).join("\n"),
      pattern,
    );
  }
  assert.match(
    validateProviderCapabilityEvidence([hook.declaration], {
      [hook.capabilityId]: {
        ...hook,
        providerPayload: { ...(hook.providerPayload as any), rollback: {} },
      },
    }).join("\n"),
    /EC2 rollback evidence shape drift/,
  );
});

test("EC2 host payload validation rejects missing host identity anchors", async () => {
  const hook = await hookEvidence("evidence");
  assert.match(
    validateProviderCapabilityEvidence(
      [hook.declaration],
      {
        [hook.capabilityId]: withIdentity(hook, {
          autoScalingGroupName: "",
          instanceId: "",
          launchTemplateId: "",
          launchTemplateVersion: "",
        }),
      },
      { awsTopology: publicAwsTopology() },
    ).join("\n"),
    /EC2 payload missing instance or ASG identity/,
  );
  assert.match(
    validateProviderCapabilityEvidence(
      [hook.declaration],
      {
        [hook.capabilityId]: withIdentity(hook, {
          instanceId: "",
          launchTemplateId: "",
        }),
      },
      { awsTopology: publicAwsTopology() },
    ).join("\n"),
    /EC2 payload missing launch-template or instance identity/,
  );
});

test("EC2 host cutover rejects missing smoke and mismatched instance identity", async () => {
  const hook = await hookEvidence("smoke");
  assert.deepEqual(
    validateCutoverProviderCapabilities(
      {
        awsTopology: publicAwsTopology(),
        providerCapabilities: { [hook.capabilityId]: hook },
      } as any,
      [hook.capabilityId],
    ),
    [],
  );
  assert.match(
    validateCutoverProviderCapabilities(
      {
        awsTopology: publicAwsTopology(),
        providerCapabilities: {
          [hook.capabilityId]: withIdentity(hook, { instanceId: "i-wrong" }),
        },
      } as any,
      [hook.capabilityId],
    ).join("\n"),
    /EC2 payload instanceId does not match selected topology/,
  );
  assert.match(
    validateCutoverProviderCapabilities(
      {
        awsTopology: publicAwsTopology(),
        providerCapabilities: {
          [hook.capabilityId]: {
            ...hook,
            smokeEvidence: false,
            providerPayload: { ...(hook.providerPayload as any), smokeEvidence: false },
          },
        },
      } as any,
      [hook.capabilityId],
    ).join("\n"),
    /missing smoke evidence/,
  );
});

test("EC2 host hook rejects missing bootstrap digest", async () => {
  const topology = publicAwsTopology() as any;
  await assert.rejects(
    runCloudProviderCapabilityHook({
      capabilityId: "aws-ec2-control-plane-host",
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      awsTopologyEvidence: {
        ...topology,
        compute: { ...topology.compute, userData: { ...topology.compute.userData, digest: "" } },
      },
      awsEc2Profile: awsEc2HookProfile(),
    }),
    /EC2 payload missing bootstrapDigest/,
  );
});

test("EC2 host hook rejects unpinned AMI identity", async () => {
  const topology = publicAwsTopology() as any;
  await assert.rejects(
    runCloudProviderCapabilityHook({
      capabilityId: "aws-ec2-control-plane-host",
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      awsTopologyEvidence: {
        ...topology,
        compute: {
          ...topology.compute,
          amiSelection: { ...topology.compute.amiSelection, pinPath: "" },
        },
      },
      awsEc2Profile: awsEc2HookProfile(),
    }),
    /AWS compute AMI selection missing pinned AMI path/,
  );
});

test("EC2 host hook rejects generated profile drift from selected identity", async () => {
  for (const [profileOverrides, pattern] of [
    [{ compute: { instanceType: "t3.micro" } }, /instanceType does not match generated profile/],
    [{ compute: { instanceId: "i-wrong" } }, /instanceId does not match generated profile/],
    [
      {
        compute: {
          instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/unreviewed",
        },
      },
      /instanceProfileArn does not match generated profile/,
    ],
    [
      { compute: { selectedSubnetIds: ["subnet-unreviewed"] } },
      /privateSubnetIds do not match generated profile/,
    ],
    [
      { compute: { securityGroupIds: ["sg-unreviewed"] } },
      /securityGroupIds do not match generated profile/,
    ],
    [
      { compute: { bootstrapDigest: "sha256:wrong" } },
      /bootstrapDigest does not match generated profile/,
    ],
    [
      { compute: { containerRuntime: "docker" } },
      /containerRuntime does not match generated profile/,
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

async function hookEvidence(phase: any) {
  return runCloudProviderCapabilityHook({
    capabilityId: "aws-ec2-control-plane-host",
    phase,
    deploymentLabel: "//deployments:staging",
    awsTopologyEvidence: publicAwsTopology(),
    awsEc2Profile: awsEc2HookProfile(),
  });
}

function withIdentity(hook: any, overrides: Record<string, unknown>) {
  return {
    ...hook,
    providerPayload: {
      ...hook.providerPayload,
      identity: { ...hook.providerPayload.identity, ...overrides },
    },
  };
}

function profileWith(overrides: Record<string, any>) {
  const profile = awsEc2HookProfile() as any;
  return {
    ...profile,
    ...overrides,
    compute: { ...profile.compute, ...(overrides.compute || {}) },
    network: { ...profile.network, ...(overrides.network || {}) },
  };
}
