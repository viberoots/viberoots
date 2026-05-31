#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";

test("Supabase PrivateLink hook emits support-mediated permission payload evidence", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
  });
  assert.equal(hook.hook.manualPrerequisite, true);
  assert.equal(hook.providerPayload?.schemaVersion, "supabase-privatelink-provider-payload@1");
  assert.deepEqual(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: hook } } as any,
      [hook.capabilityId],
    ),
    [],
  );
});

test("Supabase PrivateLink hook evidence rejects generic payloads and dashboard notes", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "supabase-privatelink-prerequisite",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
  });
  const generic = { ...hook, providerPayload: undefined };
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: generic } } as any,
      [hook.capabilityId],
    ).join("\n"),
    /missing Supabase PrivateLink provider payload evidence/,
  );
  const dashboard = {
    ...hook,
    providerPayload: { ...hook.providerPayload, supportEvidenceRef: "dashboard-only approved" },
  };
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { [hook.capabilityId]: dashboard } } as any,
      [hook.capabilityId],
    ).join("\n"),
    /dashboard/,
  );
});
