#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { awsFoundationCredentialEnv } from "../../deployments/cloud-control-aws-foundation-credentials";
import { AWS_FOUNDATION_HOOK_PAYLOAD_SCHEMA } from "../../deployments/cloud-control-aws-foundation-hooks";
import { AWS_FOUNDATION_PROFILE_SCHEMA } from "../../deployments/cloud-control-aws-foundation-types";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { validateCutoverProviderCapabilities } from "../../deployments/cloud-control-cutover-provider-capabilities";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import { publicAwsTopology } from "./cloud-control-cutover-fixture";

const awsFoundationInspection = publicAwsTopology().foundation;

test("AWS network and S3 hooks emit validated redacted foundation payloads", async () => {
  for (const capabilityId of ["aws-network-foundation", "aws-s3-artifact-store"]) {
    const hook = await runCloudProviderCapabilityHook({
      capabilityId,
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      awsFoundationInspection,
    });
    assert.equal(hook.output.classification, "redact_before_display");
    assert.equal(hook.output.redacted, true);
    assert.equal(hook.providerPayload?.schemaVersion, AWS_FOUNDATION_HOOK_PAYLOAD_SCHEMA);
    assert.equal(hook.providerPayload?.capabilityId, capabilityId);
    assert.equal(
      (hook.providerPayload?.foundation as any)?.schemaVersion,
      AWS_FOUNDATION_PROFILE_SCHEMA,
    );
    assert.deepEqual(
      validateProviderCapabilityEvidence([hook.declaration], { [capabilityId]: hook }),
      [],
    );
    assert.doesNotMatch(JSON.stringify(hook), /AKIA|aws_secret_access_key|token=/i);
  }
});

test("AWS network hook carries ingress lifecycle and import-reconcile evidence", async () => {
  for (const phase of ["preview", "apply", "evidence", "smoke", "rollback"] as const) {
    const hook = await runCloudProviderCapabilityHook({
      capabilityId: "aws-network-foundation",
      phase,
      deploymentLabel: "//deployments:staging",
      awsFoundationInspection,
    });
    const lifecycle = hook.providerPayload?.ingressLifecycle as any;
    assert.equal(lifecycle?.nonDestructiveRollback, true);
    assert.equal(lifecycle?.resources?.targetAttachmentId.includes("targetgroup"), true);
    assert.equal(lifecycle?.targetRegistration?.instanceId, "i-0abc1234");
    assert.equal(lifecycle?.operation?.action.length > 0, true);
    assert.equal(lifecycle?.operation?.evidenceSource.length > 0, true);
  }
  const imported = {
    ...awsFoundationInspection,
    network: {
      ...awsFoundationInspection.network,
      ingress: { ...awsFoundationInspection.network.ingress, mode: "import" },
    },
  };
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-network-foundation",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsFoundationInspection: imported,
  });
  assert.equal((hook.providerPayload?.ingressLifecycle as any)?.importReconcile, true);
});

test("AWS ingress evidence and smoke lifecycle declare live-compatible collection commands", async () => {
  const evidenceHook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-network-foundation",
    phase: "evidence",
    deploymentLabel: "//deployments:staging",
    awsFoundationInspection,
  });
  const smokeHook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-network-foundation",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
    awsFoundationInspection,
  });
  assert.match(JSON.stringify(evidenceHook.providerPayload), /describe-target-health/);
  assert.match(JSON.stringify(evidenceHook.providerPayload), /describe-certificate/);
  assert.equal(
    ((evidenceHook.providerPayload?.ingressLifecycle as any).operation.evidencePayload as any)
      .targetHealth.status,
    "healthy",
  );
  assert.match(JSON.stringify(smokeHook.providerPayload), /readyz/);
  assert.doesNotMatch(JSON.stringify(smokeHook.providerPayload), /<selected-public-url>/);
});

test("AWS network hook rejects missing ingress lifecycle evidence", async () => {
  const missing = {
    ...awsFoundationInspection,
    network: { ...awsFoundationInspection.network, ingress: undefined },
  };
  await assert.rejects(
    runCloudProviderCapabilityHook({
      capabilityId: "aws-network-foundation",
      phase: "evidence",
      deploymentLabel: "//deployments:staging",
      awsFoundationInspection: missing,
    }),
    /missing ingress lifecycle evidence/,
  );
});

test("AWS S3 hook smoke evidence is tied to the selected capability for cutover", async () => {
  const hook = await runCloudProviderCapabilityHook({
    capabilityId: "aws-s3-artifact-store",
    phase: "smoke",
    deploymentLabel: "//deployments:staging",
    awsFoundationInspection,
  });
  assert.deepEqual(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { "aws-s3-artifact-store": hook } } as any,
      ["aws-s3-artifact-store"],
    ),
    [],
  );
  assert.match(
    validateCutoverProviderCapabilities(
      { providerCapabilities: { "aws-network-foundation": hook } } as any,
      ["aws-network-foundation"],
    ).join("\n"),
    /unrelated capability aws-s3-artifact-store/,
  );
});

test("AWS foundation OpenTofu execution rejects assume-role without source credential file", async () => {
  const previous = {
    execute: process.env.VBR_AWS_FOUNDATION_EXECUTE_TOFU,
    live: process.env.VBR_AWS_FOUNDATION_LIVE,
    role: process.env.VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN,
    file: process.env.AWS_SHARED_CREDENTIALS_FILE,
  };
  try {
    process.env.VBR_AWS_FOUNDATION_EXECUTE_TOFU = "1";
    process.env.VBR_AWS_FOUNDATION_LIVE = "1";
    process.env.VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN = "arn:aws:iam::123456789012:role/reviewed-hook";
    delete process.env.AWS_SHARED_CREDENTIALS_FILE;
    await assert.rejects(
      runCloudProviderCapabilityHook({
        capabilityId: "aws-network-foundation",
        phase: "preview",
        deploymentLabel: "//deployments:staging",
        awsFoundationInspection,
      }),
      /requires AWS_SHARED_CREDENTIALS_FILE/,
    );
  } finally {
    restoreEnv("VBR_AWS_FOUNDATION_EXECUTE_TOFU", previous.execute);
    restoreEnv("VBR_AWS_FOUNDATION_LIVE", previous.live);
    restoreEnv("VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN", previous.role);
    restoreEnv("AWS_SHARED_CREDENTIALS_FILE", previous.file);
  }
});

test("AWS foundation credential env strips ambient AWS inputs", () => {
  const previous = {
    access: process.env.AWS_ACCESS_KEY_ID,
    file: process.env.AWS_SHARED_CREDENTIALS_FILE,
    profile: process.env.AWS_PROFILE,
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aws-foundation-creds-")), "creds");
  fs.writeFileSync(file, "[default]\naws_access_key_id=x\naws_secret_access_key=y\n");
  try {
    process.env.AWS_ACCESS_KEY_ID = "ambient";
    process.env.AWS_PROFILE = "ambient-profile";
    process.env.AWS_SHARED_CREDENTIALS_FILE = file;
    const env = awsFoundationCredentialEnv();
    assert.equal(env.AWS_SHARED_CREDENTIALS_FILE, file);
    assert.equal(env.AWS_PROFILE, "default");
    assert.equal(env.AWS_EC2_METADATA_DISABLED, "true");
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  } finally {
    restoreEnv("AWS_ACCESS_KEY_ID", previous.access);
    restoreEnv("AWS_SHARED_CREDENTIALS_FILE", previous.file);
    restoreEnv("AWS_PROFILE", previous.profile);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
