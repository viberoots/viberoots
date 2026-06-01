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

test("cutover rejects placeholder and non-envelope runtime HTTP evidence", () => {
  for (const value of [
    { evidenceRef: "http-health.json", checkedAt: new Date().toISOString() },
    true,
    2,
    { evidencePath: "/tmp/http-health.json" },
  ]) {
    assertError({ cloudHealth: value }, /runtime HTTP health.*schemaVersion|typed envelope/);
  }
});

test("cutover rejects failed, stale, mismatched, and token-leaking HTTP evidence", () => {
  assertError(
    { cloudHealth: { ...runtimeHttpEvidence("health"), status: { ok: false, httpStatus: 503 } } },
    /runtime HTTP health status did not pass/,
  );
  assertError(
    { cloudHealth: { ...runtimeHttpEvidence("health"), checkedAt: staleIso() } },
    /runtime HTTP health checkedAt is stale/,
  );
  assertError(
    {
      cloudHealth: { ...runtimeHttpEvidence("health"), url: "https://wrong.example.test/healthz" },
    },
    /runtime HTTP health URL\/host binding invalid|host does not match expected URL/,
  );
  assertError(
    { cloudHealth: { ...runtimeHttpEvidence("health"), body: { ok: true } } },
    /runtime HTTP health response missing runtime identity/,
  );
  assertError(
    {
      cloudHealth: {
        ...runtimeHttpEvidence("health"),
        body: { ok: true, instanceId: "i-wrong" },
      },
    },
    /runtime HTTP health response runtime identity does not match expected profile/,
  );
  assertError(
    {
      workerHeartbeats: {
        ...runtimeHttpEvidence("worker-heartbeats"),
        credentialSource: {
          kind: "token_file",
          tokenFile: "control-plane-token",
          tokenValue: "Bearer abcdefghijklmnop",
        },
      },
    },
    /inline token values/,
  );
});

test("cutover rejects incomplete readiness and worker heartbeat evidence", () => {
  assertError(
    {
      readiness: { ...runtimeHttpEvidence("readiness"), dependencies: { database: { ok: true } } },
    },
    /artifact store dependency detail/,
  );
  assertError(
    { workerHeartbeats: { ...runtimeHttpEvidence("worker-heartbeats"), body: { workers: [] } } },
    /missing expected worker heartbeat count/,
  );
  assertError(
    {
      workerHeartbeats: withExpected(
        {
          ...runtimeHttpEvidence("worker-heartbeats"),
          body: { workers: [worker("worker-1")] },
        },
        { workerCount: 1 },
      ),
    },
    /missing expected worker heartbeat count/,
  );
  {
    const lowered = evidence({
      expectedWorkerCount: 1,
      health: {
        ...(evidence().health as any),
        workerHeartbeats: withExpected(
          {
            ...runtimeHttpEvidence("worker-heartbeats"),
            body: { workers: [worker("worker-1")] },
          },
          { workerCount: 1 },
        ),
      },
    });
    const result = validateCloudControlCutover(lowered, OPTIONS);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /missing expected worker heartbeat count/);
  }
  assertError(
    {
      readiness: {
        ...runtimeHttpEvidence("readiness"),
        dependencies: {
          database: { ok: true },
          artifactStore: { ok: true },
          workerQueueLocks: { ok: true },
        },
      },
    },
    /runtime config dependency detail/,
  );
  assertError(
    {
      readiness: {
        ...runtimeHttpEvidence("readiness"),
        body: {
          ok: true,
          database: { ok: true },
          artifactStore: { ok: true },
          workerQueueLocks: { ok: true },
        },
        dependencies: {
          database: { ok: true },
          artifactStore: { ok: true },
          workerQueueLocks: { ok: true },
          runtimeConfig: { ok: true },
        },
      },
    },
    /runtime HTTP readiness response missing runtime identity/,
  );
  assertError(
    {
      readiness: {
        ...runtimeHttpEvidence("readiness"),
        body: {
          ok: true,
          database: { ok: true },
          artifactStore: { ok: true },
          workerQueueLocks: { ok: true },
          runtimeConfig: { ok: true, profileIdentity: "i-wrong" },
        },
        dependencies: {
          database: { ok: true },
          artifactStore: { ok: true },
          workerQueueLocks: { ok: true },
          runtimeConfig: { ok: true, profileIdentity: "i-wrong" },
        },
      },
    },
    /runtime HTTP readiness response runtime identity does not match expected profile/,
  );
  assertError(
    {
      workerHeartbeats: {
        ...runtimeHttpEvidence("worker-heartbeats"),
        body: {
          workers: [
            {
              workerId: "worker-1",
              instanceId: "aws-ec2-instance-i-123",
              status: "running",
              lastSeenAt: staleIso(),
            },
          ],
        },
      },
    },
    /worker heartbeat checkedAt is stale/,
  );
  assertError(
    {
      workerHeartbeats: {
        ...runtimeHttpEvidence("worker-heartbeats"),
        body: {
          workers: [
            {
              workerId: "worker-1",
              instanceId: "i-wrong",
              status: "stopped",
              lastSeenAt: new Date().toISOString(),
            },
          ],
        },
      },
    },
    /is not running|identity does not match profile/,
  );
});

function assertError(healthOverride: Record<string, unknown>, pattern: RegExp) {
  const result = validateCloudControlCutover(
    evidence({ health: { ...(evidence().health as any), ...healthOverride } }),
    OPTIONS,
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), pattern);
}

function withExpected(value: unknown, expected: Record<string, unknown>) {
  return { ...(value as any), expected: { ...(value as any).expected, ...expected } };
}

function staleIso(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

function worker(workerId: string) {
  return {
    workerId,
    instanceId: "aws-ec2-instance-i-123",
    status: "running",
    lastSeenAt: new Date().toISOString(),
  };
}
