#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import {
  evidence,
  IMAGE_BUILD_IDENTITY,
  runtimeHttpEvidence,
} from "./cloud-control-cutover-fixture";

const OPTIONS = {
  operation: "cutover" as const,
  expectedHostProfile: "aws-ec2",
  expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
  expectedRegion: "us-east-1",
  selectedCapabilities: [],
  maxAgeMinutes: 60,
};
const HTTP_KEYS = [
  ["cloudHealth", "health"],
  ["readiness", "readiness"],
  ["workerHeartbeats", "worker-heartbeats"],
  ["uiReads", "health"],
  ["mcpReads", "readiness"],
] as const;

test("cutover validates expected fields on every runtime HTTP envelope key", () => {
  for (const [key, check] of HTTP_KEYS) {
    assertExpectedError(key, check, { deploymentIds: undefined }, /deploymentIds missing/);
    assertExpectedError(key, check, { deploymentIds: ["tampered"] }, /deploymentIds do not match/);
    assertExpectedError(key, check, { workerCount: undefined }, /workerCount missing/);
    assertExpectedError(key, check, { workerCount: 99 }, /workerCount does not match/);
  }
});

function assertExpectedError(
  key: string,
  check: (typeof HTTP_KEYS)[number][1],
  expected: Record<string, unknown>,
  pattern: RegExp,
) {
  const health = {
    ...(evidence().health as any),
    [key]: withExpected(runtimeHttpEvidence(check), expected),
  };
  const result = validateCloudControlCutover(evidence({ health }), OPTIONS);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), pattern);
}

function withExpected(value: unknown, expected: Record<string, unknown>) {
  return { ...(value as any), expected: { ...(value as any).expected, ...expected } };
}
