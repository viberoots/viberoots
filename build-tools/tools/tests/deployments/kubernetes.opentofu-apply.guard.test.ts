#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  OpenTofuApplyMismatchError,
  runOpenTofuReviewedApply,
} from "../../deployments/opentofu-apply";
import {
  PLAN_FINGERPRINT,
  fakeSecretRuntime,
  provisionerMetadata,
  recordingAdapter,
  setupArtifact,
  throwingSecretRuntime,
  writePlanArtifact,
} from "./kubernetes.opentofu-apply.helpers";

async function tempDir(t: any): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), ".opentofu-apply-guard-"));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));
  return tmp;
}

test("runOpenTofuReviewedApply rejects mismatched stack config fingerprint", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "stack-config-mismatch.json");
  await writePlanArtifact({
    artifactPath,
    stackConfigFingerprint: "sha256:recorded-stack-config",
  });
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: "sha256:admitted-stack-config",
  };
  const { adapter, calls } = recordingAdapter();
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
      error instanceof OpenTofuApplyMismatchError &&
      error.reason === "stack_config_fingerprint_mismatch",
  );
  assert.equal(calls.length, 0, "adapter must not run when stack config fingerprint mismatches");
  assert.deepEqual(secrets.calls, [], "secret runtime must not be entered on rejection");
});

test("runOpenTofuReviewedApply rejects when provision credentials cannot be resolved", async (t) => {
  const tmp = await tempDir(t);
  const provisionerPlan = await setupArtifact(tmp, "missing-credentials");
  const { adapter, calls } = recordingAdapter();
  const secrets = throwingSecretRuntime(
    "deployment secret runtime missing required provision credentials",
  );
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    /missing required provision credentials/,
  );
  assert.deepEqual(secrets.calls, ["provision"]);
  assert.equal(
    calls.length,
    0,
    "apply adapter must not run when provision credentials are missing",
  );
  const recordedArtifact = await fsp.readFile(provisionerPlan.artifactPath, "utf8");
  const parsed = JSON.parse(recordedArtifact);
  assert.equal(
    parsed.opentofu.planFingerprint,
    PLAN_FINGERPRINT,
    "plan artifact must remain unchanged when apply rejects",
  );
});
