#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-setup-validate";

test("readiness and cutover reject stale provider-capability hook evidence", async () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const readinessHook = await hookEvidence("aws-ec2-control-plane-host", "evidence");
  const staleReadiness = { ...readinessHook, checkedAt: old };
  assert.match(
    validateProviderCapabilityEvidence([readinessHook.declaration], {
      [readinessHook.capabilityId]: staleReadiness,
    }).join("\n"),
    /provider-capability evidence is missing or stale/,
  );
  const cutoverHook = await hookEvidence("aws-ec2-control-plane-host", "smoke");
  const staleCutover = { ...cutoverHook, checkedAt: old };
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [cutoverHook.capabilityId]: staleCutover } } as any,
      [cutoverHook.capabilityId],
      60,
    ).join("\n"),
    /provider-capability evidence is missing or stale/,
  );
});

function hookEvidence(capabilityId: string, phase: "evidence" | "smoke") {
  return runCloudProviderCapabilityHook({
    capabilityId,
    phase,
    deploymentLabel: "//deployments:staging",
  });
}
