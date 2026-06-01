#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { validateCloudControlSetupInput } from "../../deployments/cloud-control-setup-validate";
import { ec2HostProfileInput } from "./cloud-control-aws-ec2-host-profile.fixture";
import { imagePublication, registryProfile } from "./cloud-control-aws-ecr-registry.fixture";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  imagePublicationEvidence,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";

test("AWS ECR registry profile rejects trusted topology account or region drift", () => {
  const topology = privateLinkAwsTopology();
  const errors = validateCloudControlSetupInput(
    ec2HostProfileInput({
      awsTopology: { ...topology, accountId: "210987654321" },
    }),
  ).join("\n");
  assert.match(errors, /account does not match trusted AWS topology/);
});

test("setup and cutover reject incomplete ECR registry evidence", () => {
  for (const [name, mutate, pattern] of [
    [
      "missing policy",
      (profile: any) => ({ ...profile, immutability: { ...profile.immutability, evidence: "" } }),
      /immutability evidence|immutable tag policy/,
    ],
    [
      "missing lifecycle",
      (profile: any) => ({
        ...profile,
        lifecyclePolicy: { ...profile.lifecyclePolicy, ruleCount: 0 },
      }),
      /lifecycle policy/,
    ],
    [
      "missing scanning",
      (profile: any) => ({ ...profile, scanning: { status: "enabled", evidence: "" } }),
      /image scanning evidence/,
    ],
    [
      "missing pull",
      (profile: any) => ({ ...profile, runtimePull: { ...profile.runtimePull, evidence: "" } }),
      /runtime pull permission/,
    ],
    [
      "missing publish",
      (profile: any) => ({ ...profile, publish: { ...profile.publish, evidence: "" } }),
      /publish permission/,
    ],
    [
      "wrong region",
      (profile: any) => ({ ...profile, identity: { ...profile.identity, region: "us-west-2" } }),
      /region does not match trusted AWS topology/,
    ],
  ] as const) {
    const profile = mutate(registryProfile());
    const setupErrors = validateCloudControlSetupInput(
      ec2HostProfileInput({
        imagePublication: { ...imagePublication(), registryProfile: profile },
      }),
    ).join("\n");
    const cutoverErrors = validateCloudControlCutover(
      evidence({ imagePublication: imagePublicationEvidence({ registryProfile: profile }) }),
      {
        operation: "cutover",
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        selectedCapabilities: [],
        maxAgeMinutes: 60,
      },
    ).errors.join("\n");
    assert.match(setupErrors, pattern, name);
    assert.match(cutoverErrors, pattern, name);
  }
});
