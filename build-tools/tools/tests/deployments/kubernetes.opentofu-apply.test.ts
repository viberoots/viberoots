#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { OpenTofuProvisionerMetadata } from "../../deployments/opentofu-stack.ts";
import {
  OpenTofuApplyMismatchError,
  runOpenTofuReviewedApply,
} from "../../deployments/opentofu-apply.ts";
import {
  PLAN_FINGERPRINT,
  STACK_CONFIG_FINGERPRINT,
  fakeSecretRuntime,
  provisionerMetadata,
  recordingAdapter,
  setupArtifact,
  writePlanArtifact,
} from "./kubernetes.opentofu-apply.helpers.ts";

async function tempDir(t: any): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), ".opentofu-apply-"));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));
  return tmp;
}

test("runOpenTofuReviewedApply records succeeded outcome with credentials and command metadata", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "succeeded");
  const { adapter, calls } = recordingAdapter({ stdout: "apply complete resources 1 added" });
  const secrets = fakeSecretRuntime({
    opentofu_provider_credentials: "vault:secret/opentofu/prod",
  });
  const outcome = await runOpenTofuReviewedApply({
    provisioner: provisionerMetadata(),
    provisionerPlan,
    admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
    secretRuntime: secrets.runtime,
    adapter,
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stackIdentity, "foundation/prod");
  assert.equal(outcome.stateBackendIdentity, "s3://state-prod/foundation");
  assert.equal(outcome.planFingerprint, PLAN_FINGERPRINT);
  assert.equal(outcome.stackConfigFingerprint, STACK_CONFIG_FINGERPRINT);
  assert.equal(outcome.command.binary, "tofu");
  assert.equal(outcome.command.argCount, 3);
  assert.deepEqual(outcome.command.credentialEnvNames, ["opentofu_provider_credentials"]);
  assert.deepEqual(secrets.calls, ["provision"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].planArtifactPath, provisionerPlan.artifactPath);
  assert.equal(outcome.diagnostics?.classification, "display_safe");
  const serialized = JSON.stringify(outcome);
  assert.ok(
    !serialized.includes("vault:secret/opentofu/prod"),
    "secret value must not appear in serialized outcome",
  );
});

test("runOpenTofuReviewedApply rejects mismatched admitted plan fingerprint", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "admitted-mismatch");
  const { adapter } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: "sha256:tampered",
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "admitted_plan_fingerprint_mismatch",
  );
});

test("runOpenTofuReviewedApply rejects missing plan artifact", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = {
    artifactPath: path.join(tmp, "missing.json"),
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError && error.reason === "plan_artifact_missing",
  );
});

test("runOpenTofuReviewedApply rejects destructive plan without reviewed exception", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "destructive.json");
  await writePlanArtifact({ artifactPath, actions: ["delete"] });
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    /opentofu plan action "delete" is not safe/,
  );
});

test("runOpenTofuReviewedApply rejects state backend identity drift", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "drift");
  const drifted: OpenTofuProvisionerMetadata = provisionerMetadata({
    stateBackendIdentity: "s3://state-staging/foundation",
  });
  const { adapter } = recordingAdapter();
  const secrets = fakeSecretRuntime({});
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: drifted,
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "state_backend_identity_mismatch",
  );
});

test("runOpenTofuReviewedApply admits destructive plan with reviewed exception", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "reviewed-destructive.json");
  await writePlanArtifact({ artifactPath, actions: ["create", "update"] });
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter } = recordingAdapter({ stdout: "apply complete" });
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  const outcome = await runOpenTofuReviewedApply({
    provisioner: provisionerMetadata(),
    provisionerPlan,
    admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
    secretRuntime: secrets.runtime,
    adapter,
    evidence: { destructiveExceptionRef: "incident://INC-42/reviewed" },
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.destructiveExceptionRef, "incident://INC-42/reviewed");
});

test("runOpenTofuReviewedApply records failed outcome with redacted diagnostics", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "failure");
  const { adapter } = recordingAdapter({
    exitCode: 1,
    stderr:
      "Error: provider authorization failed token=ABC123XYZ secret=ZZZ private_key block detected",
  });
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  const outcome = await runOpenTofuReviewedApply({
    provisioner: provisionerMetadata(),
    provisionerPlan,
    admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
    secretRuntime: secrets.runtime,
    adapter,
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.diagnostics?.classification, "redact_before_display");
  assert.equal(outcome.diagnostics?.redacted, true);
  assert.ok(!outcome.diagnostics?.summary.includes("ABC123XYZ"));
});
