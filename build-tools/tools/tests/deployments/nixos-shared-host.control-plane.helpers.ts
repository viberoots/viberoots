#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function writeDemoArtifact(root: string, body = "demoapp"): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${body}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

export async function withEnvOverrides<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(fn: () => Promise<T | null>, message: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(message);
}

export async function expectPausedSubmission<T>(
  run: Promise<T>,
  validate?: (error: any) => void,
): Promise<any> {
  let paused: any;
  await assert.rejects(run, (error: any) => {
    paused = error;
    validate?.(error);
    return true;
  });
  return paused;
}

export function smokeConnectOverride(port: number) {
  return {
    protocol: "https:" as const,
    hostname: "127.0.0.1",
    port,
    rejectUnauthorized: false,
  };
}

export async function assertFrozenSnapshotExecution(result: any): Promise<void> {
  const snapshot = JSON.parse(await fsp.readFile(result.executionSnapshotPath, "utf8"));
  assert.equal(snapshot.deploymentId, "demoapp-dev");
  assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
  assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
  assert.equal(snapshot.action.publishInput.kind, "exact-artifact");
  assert.equal(snapshot.provisionerPlan?.mutationClass, "non_destructive");
  assert.ok(snapshot.provisionerPlan?.artifactPath);
  assert.equal(
    snapshot.admittedContext.policyEvaluation.binding.provisionerPlanFingerprint,
    snapshot.provisionerPlan?.fingerprint,
  );
  assert.equal(snapshot.admittedContext.source.sourceRef, "env/pleomino/dev");
  assert.equal(snapshot.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
  assert.equal(snapshot.admittedContext.policyEvaluation.binding.targetIdentity, result.lockScope);
  assert.equal(snapshot.action.publishInput.artifact.identity, result.record.artifact?.identity);
  assert.equal(result.record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
  assert.equal(result.record.admittedContext.source.mode, "stage_branch_head");
  assert.equal(result.record.provisionerPlan?.fingerprint, snapshot.provisionerPlan?.fingerprint);
  assert.equal(
    result.record.admittedContext.policyEvaluation.binding.targetIdentity,
    result.lockScope,
  );
  assert.ok(result.record.controlPlane);
  assert.equal(result.record.controlPlane.submissionId, result.submission.submissionId);
  assert.equal(result.record.controlPlane.executionSnapshotPath, result.executionSnapshotPath);
}
