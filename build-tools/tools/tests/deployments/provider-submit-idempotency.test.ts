#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  fingerprintProviderSubmissionPayload,
  resolveProviderSubmitIdempotency,
} from "../../deployments/deployment-provider-submit-idempotency";
import { queueFrozenProviderSubmission } from "../../deployments/deployment-provider-frozen-snapshot";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";

const admission = {
  decision: "admitted" as const,
  reason: "shared_nonprod" as const,
  policyEvaluation: { binding: { payloadFingerprint: "sha256:admitted" } } as any,
};

function snapshot(provider: string, patch: Record<string, unknown> = {}) {
  const { submissionId, ...rest } = patch;
  return {
    schemaVersion: `${provider}-control-plane-snapshot@1`,
    submissionId: `${provider}-${String(submissionId || "one")}`,
    submittedAt: "2026-05-06T12:00:00.000Z",
    operationKind: patch.operationKind || "deploy",
    deploymentId: `${provider}-deployment`,
    deploymentLabel: `//projects/deployments/${provider}:deploy`,
    providerTargetIdentity: `${provider}:team/project#staging`,
    lockScope: `${provider}:team/project#staging`,
    artifact: { identity: `${provider}-artifact:abc` },
    parentRunId: patch.parentRunId,
    releaseLineageId: patch.releaseLineageId,
    artifactLineageId: patch.artifactLineageId,
    expectedSourceRevision: patch.expectedSourceRevision,
    sourceRunId: patch.sourceRunId,
    smokeConnectOverride: patch.smokeConnectOverride,
    admission,
    ...rest,
  };
}

function backend(recordsRoot: string) {
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

test("provider submit idempotency marks identical payloads as duplicate", async () => {
  await runInTemp("provider-submit-idempotency", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    for (const provider of ["vercel", "kubernetes", "s3-static"]) {
      const first = await queueFrozenProviderSubmission({
        recordsRoot,
        backend: backend(recordsRoot),
        snapshot: snapshot(provider, { submissionId: "first" }) as any,
      });
      const second = await queueFrozenProviderSubmission({
        recordsRoot,
        backend: backend(recordsRoot),
        snapshot: snapshot(provider, { submissionId: "second" }) as any,
      });
      assert.equal(first.submissionId, `${provider}-first`);
      assert.equal(second.submissionId, `${provider}-first`);
      assert.equal(first.dedupe.mode, "created");
      assert.equal(second.dedupe.mode, "duplicate");
      assert.equal(second.dedupe.requestFingerprint, first.dedupe.requestFingerprint);
      assert.ok(first.dedupe.requestFingerprint.startsWith("sha256:"));
      assert.equal(first.dedupe.requestFingerprint.startsWith("direct:"), false);
    }
  });
});

test("provider submit payload differences produce distinct idempotency fingerprints", async () => {
  const base = snapshot("vercel", { sourceRunId: "run-a" });
  const cases = [
    snapshot("vercel", { operationKind: "rollback", sourceRunId: "run-a" }),
    snapshot("vercel", { providerTargetIdentity: "vercel:team/other#staging" }),
    snapshot("vercel", { artifact: { identity: "vercel-artifact:def" } }),
    snapshot("vercel", { sourceRunId: "run-b" }),
    snapshot("vercel", { parentRunId: "preview-cleanup-run" }),
    snapshot("vercel", { smokeConnectOverride: { hostname: "127.0.0.1", port: 4100 } }),
  ];
  const baseFingerprint = fingerprintProviderSubmissionPayload(base as any);
  for (const changed of cases) {
    assert.notEqual(fingerprintProviderSubmissionPayload(changed as any), baseFingerprint);
  }
});

test("provider submit idempotency helper reports duplicate for matching payload fingerprint", async () => {
  await runInTemp("provider-submit-idempotency-helper", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const shared = backend(recordsRoot);
    const first = await resolveProviderSubmitIdempotency({
      backend: shared,
      snapshot: snapshot("s3-static", { submissionId: "one" }) as any,
    });
    const duplicate = await resolveProviderSubmitIdempotency({
      backend: shared,
      snapshot: snapshot("s3-static", { submissionId: "two" }) as any,
    });
    assert.equal(first.mode, "created");
    assert.equal(duplicate.mode, "duplicate");
    assert.equal(duplicate.targetId, "s3-static-one");
    assert.equal(duplicate.requestFingerprint, first.requestFingerprint);
  });
});
