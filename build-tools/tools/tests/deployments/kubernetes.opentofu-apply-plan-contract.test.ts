#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  OpenTofuApplyMismatchError,
  runOpenTofuReviewedApply,
} from "../../deployments/opentofu-apply";
import { readOpenTofuResolvedPlan } from "../../deployments/opentofu-stack";
import {
  PLAN_FINGERPRINT,
  STACK_CONFIG_FINGERPRINT,
  fakeSecretRuntime,
  provisionerMetadata,
  recordingAdapter,
  writePlanArtifact,
} from "./kubernetes.opentofu-apply.helpers";

async function tempDir(t: any): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(process.cwd(), ".opentofu-plan-contract-"));
  t.after(() => fsp.rm(tmp, { recursive: true, force: true }));
  return tmp;
}

test("readOpenTofuResolvedPlan rejects reviewed JSON as apply plan", async (t) => {
  const tmp = await tempDir(t);
  const stackRoot = path.join(tmp, "projects", "deployments", "demo", "opentofu");
  await fsp.mkdir(stackRoot, { recursive: true });
  await fsp.writeFile(
    path.join(stackRoot, "stack.json"),
    JSON.stringify({ plan_json: "plan.json", apply_plan: "apply.json" }),
  );
  await fsp.writeFile(path.join(stackRoot, "plan.json"), '{"resource_changes":[]}\n');
  await fsp.writeFile(path.join(stackRoot, "apply.json"), '{"format_version":"1.2"}\n');
  await assert.rejects(
    readOpenTofuResolvedPlan({
      workspaceRoot: tmp,
      packagePath: "projects/deployments/demo",
      provisioner: provisionerMetadata(),
    }),
    /apply_plan must be a saved plan artifact, not reviewed plan JSON/,
  );
});

test("readOpenTofuResolvedPlan rejects missing apply_plan", async (t) => {
  const tmp = await tempDir(t);
  const stackRoot = path.join(tmp, "projects", "deployments", "demo", "opentofu");
  await fsp.mkdir(stackRoot, { recursive: true });
  await fsp.writeFile(
    path.join(stackRoot, "stack.json"),
    JSON.stringify({ plan_json: "plan.json" }),
  );
  await fsp.writeFile(path.join(stackRoot, "plan.json"), '{"resource_changes":[]}\n');
  await assert.rejects(
    readOpenTofuResolvedPlan({
      workspaceRoot: tmp,
      packagePath: "projects/deployments/demo",
      provisioner: provisionerMetadata(),
    }),
    /opentofu stack config must declare apply_plan:/,
  );
});

test("runOpenTofuReviewedApply rejects JSON plan as saved apply plan", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "json-apply-plan.json");
  await writePlanArtifact({ artifactPath });
  const raw = JSON.parse(await fsp.readFile(artifactPath, "utf8"));
  raw.opentofu.applyPlanPath = raw.opentofu.planJsonPath;
  await fsp.writeFile(artifactPath, JSON.stringify(raw, null, 2) + "\n");
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError && error.reason === "apply_plan_artifact_invalid",
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(secrets.calls, []);
});

test("runOpenTofuReviewedApply rejects missing recorded apply plan path", async (t) => {
  const tmp = await tempDir(t);
  const artifactPath = path.join(tmp, "missing-apply-plan-path.json");
  await writePlanArtifact({ artifactPath });
  const raw = JSON.parse(await fsp.readFile(artifactPath, "utf8"));
  delete raw.opentofu.applyPlanPath;
  await fsp.writeFile(artifactPath, JSON.stringify(raw, null, 2) + "\n");
  const provisionerPlan = {
    artifactPath,
    fingerprint: "sha256:provisioner-plan",
    mutationClass: "non_destructive" as const,
    planFingerprint: PLAN_FINGERPRINT,
    stackConfigFingerprint: STACK_CONFIG_FINGERPRINT,
  };
  const { adapter, calls } = recordingAdapter();
  const secrets = fakeSecretRuntime({ opentofu_provider_credentials: "vault" });
  await assert.rejects(
    runOpenTofuReviewedApply({
      provisioner: provisionerMetadata(),
      provisionerPlan,
      admittedProvisionerPlanFingerprint: provisionerPlan.fingerprint,
      secretRuntime: secrets.runtime,
      adapter,
    }),
    (error) =>
      error instanceof OpenTofuApplyMismatchError && error.reason === "recorded_apply_plan_missing",
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(secrets.calls, []);
});
