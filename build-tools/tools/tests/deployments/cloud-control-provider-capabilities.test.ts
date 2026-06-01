#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  capabilityDeclaration,
  CLOUD_CAPABILITY_IDS,
} from "../../deployments/cloud-control-setup-contract";
import { validateProviderCapabilityDeclaration } from "../../deployments/cloud-control-setup-validate";

const execFileAsync = promisify(execFile);

test("concrete cloud provider capabilities validate structurally", () => {
  for (const id of CLOUD_CAPABILITY_IDS) {
    const capability = capabilityDeclaration(id);
    assert.equal(capability.id, id);
    assert.deepEqual(validateProviderCapabilityDeclaration(capability), []);
    assert.match(capability.iac.previewCommand, /^deployment-control-plane provider-capability/);
    assert.match(capability.iac.smokeCommand, /^deployment-control-plane provider-capability/);
    assert.doesNotMatch(JSON.stringify(capability), /<reviewed|placeholder provider/i);
  }
});

test("provider capability validation rejects every required missing contract field", () => {
  const capability = capabilityDeclaration("aws-ec2-control-plane-host");
  for (const [field, patch] of missingFieldCases()) {
    assert.match(
      validateProviderCapabilityDeclaration({ ...capability, ...patch }).join("\n"),
      new RegExp(`${field} must not be empty|concrete capability catalog`),
      field,
    );
  }
});

test("provider capability validation rejects missing reviewed hook commands", () => {
  const capability = capabilityDeclaration("aws-ec2-control-plane-host");
  for (const field of [
    "previewCommand",
    "applyCommand",
    "smokeCommand",
    "evidenceCommand",
    "rollbackCommand",
  ]) {
    assert.match(
      validateProviderCapabilityDeclaration({
        ...capability,
        iac: { ...capability.iac, [field]: "" },
      }).join("\n"),
      /concrete capability catalog|reviewed deploy admission/,
      field,
    );
  }
});

test("live-gated selected provider capability preview and smoke hooks", async (t) => {
  if (process.env.VBR_CLOUD_PROVIDER_CAPABILITY_LIVE !== "1") {
    t.skip("set VBR_CLOUD_PROVIDER_CAPABILITY_LIVE=1 for live provider preview/smoke hooks");
    return;
  }
  const label = requiredEnv("VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_DEPLOYMENT_LABEL");
  assert.doesNotMatch(label, /^(prod|production)$/i);
  for (const id of liveCapabilityIds()) {
    const capability = capabilityDeclaration(id);
    for (const command of [capability.iac.previewCommand, capability.iac.smokeCommand]) {
      await execFileAsync("sh", ["-c", command.replace("<label>", label)], {
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    }
  }
});

function missingFieldCases(): Array<[string, Record<string, unknown>]> {
  return [
    ["targetIdentity", { targetIdentity: "" }],
    ["credentialSource", { credentialSource: "" }],
    ["lockScope", { lockScope: "" }],
    ["previewDiffBehavior", { previewDiffBehavior: "" }],
    ["mutationSequence", { mutationSequence: [] }],
    ["smokeChecks", { smokeChecks: [] }],
    ["rollbackProcedure", { rollbackProcedure: [] }],
    ["replaySemantics", { replaySemantics: "" }],
    ["auditEvidence", { auditEvidence: [] }],
    ["protectedSharedEligibility", { protectedSharedEligibility: "" }],
  ];
}

function liveCapabilityIds(): string[] {
  const raw = process.env.VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_IDS || "aws-ec2-control-plane-host";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required when live provider capability hooks are enabled`);
  return value;
}
