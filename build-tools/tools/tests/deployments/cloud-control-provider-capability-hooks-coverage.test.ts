#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUD_CAPABILITY_IDS } from "../../deployments/cloud-control-setup-contract";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";

test("provider-capability hook dispatch covers every concrete capability", async () => {
  for (const capabilityId of CLOUD_CAPABILITY_IDS) {
    const hook = await runCloudProviderCapabilityHook({
      capabilityId,
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      ...awsFoundationInspection(capabilityId),
    });
    assert.equal(hook.capabilityId, capabilityId);
    assert.equal(hook.declaration.id, capabilityId);
    assert.ok(hook.hook.adapter);
  }
});

function awsFoundationInspection(capabilityId: string) {
  return capabilityId === "aws-network-foundation" || capabilityId === "aws-s3-artifact-store"
    ? { awsFoundationInspection: publicAwsTopology().foundation }
    : {};
}
