#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD_CAPABILITY_IDS } from "../../deployments/cloud-control-setup-contract";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";
import { awsEc2HookProfile } from "./cloud-control-aws-ec2-hook-profile.fixture";
import {
  imagePublication,
  registryProfile,
  withAwsCredentialFile,
} from "./cloud-control-aws-ecr-registry.fixture";
import { providerInputs as pr33ProviderInputs } from "./cloud-control-remaining-capabilities.fixture";

test("provider-capability hook dispatch covers every concrete capability", async () => {
  for (const capabilityId of CLOUD_CAPABILITY_IDS) {
    const hook = await runHook(capabilityId);
    assert.equal(hook.capabilityId, capabilityId);
    assert.equal(hook.declaration.id, capabilityId);
    assert.ok(hook.hook.adapter);
  }
});

async function runHook(capabilityId: string) {
  const run = () =>
    runCloudProviderCapabilityHook({
      capabilityId,
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      ...(capabilityId === "aws-ec2-control-plane-host"
        ? { awsTopologyEvidence: publicAwsTopology(), awsEc2Profile: awsEc2HookProfile() }
        : {}),
      ...(capabilityId === "aws-ecr-control-plane-registry"
        ? {
            awsTopologyEvidence: publicAwsTopology(),
            registryProfile: registryProfile(),
            imagePublication: imagePublication(),
          }
        : {}),
      ...(pr33Inputs(capabilityId) as any),
      ...awsFoundationInspection(capabilityId),
    });
  return capabilityId === "aws-ecr-control-plane-registry" ? withAwsCredentialFile(run) : run();
}

function pr33Inputs(capabilityId: string) {
  return [
    "aws-attic-cache-service",
    "cloudflare-edge",
    "vercel-operator-ui",
    "remote-build-worker-fleet",
  ].includes(capabilityId)
    ? pr33ProviderInputs(capabilityId)
    : {};
}

function awsFoundationInspection(capabilityId: string) {
  return capabilityId === "aws-network-foundation" || capabilityId === "aws-s3-artifact-store"
    ? { awsFoundationInspection: publicAwsTopology().foundation }
    : {};
}
