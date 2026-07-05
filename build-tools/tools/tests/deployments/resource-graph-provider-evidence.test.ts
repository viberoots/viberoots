#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { REVIEWED_PROVIDER_IDS } from "../../deployments/deployment-provider-capabilities";
import {
  assertProviderEvidenceFieldSupported,
  normalizeProviderEvidenceFacts,
  providerEvidenceMatrix,
} from "../../deployments/resource-graph-provider-evidence";

test("provider evidence matrix covers every reviewed provider with explicit semantics", () => {
  const matrix = providerEvidenceMatrix();
  assert.deepEqual(matrix.map((entry) => entry.provider).sort(), [...REVIEWED_PROVIDER_IDS].sort());
  for (const entry of matrix) {
    for (const field of [
      "liveTargetIdentity",
      "lastKnownProviderReleaseId",
      "driftSignal",
      "previewTargetEvidence",
      "partialPublishEvidence",
      "smokeReadinessEvidence",
      "rollbackRecoveryEvidence",
    ] as const) {
      assert.match(entry.fields[field], /^(supported|unsupported|deferred)$/);
    }
  }
});

test("provider evidence normalization keeps provider differences explicit", () => {
  const cloudflare = normalizeProviderEvidenceFacts({
    provider: "cloudflare-pages",
    providerTargetIdentity: "cloudflare-pages:web/project",
    providerReleaseId: "cf-release-1",
    previewTarget: "preview-url",
    finalOutcome: "succeeded",
    publishMode: "preview",
    smokeOutcome: "passed",
    admittedContext: { sourcePlanRef: "source-plan:cf" },
    executionSnapshotSubmissionId: "submission-1",
  });
  assert.equal(cloudflare.previewTargetEvidence, "preview-url");
  assert.equal(cloudflare.sourcePlanRef, "source-plan:cf");

  const s3 = normalizeProviderEvidenceFacts({
    provider: "s3-static",
    providerTargetIdentity: "s3-static:web/bucket",
    previewTarget: "should-not-be-used",
    finalOutcome: "succeeded",
  });
  assert.equal(s3.previewTargetEvidence, "unsupported");
  assert.throws(
    () => assertProviderEvidenceFieldSupported("s3-static", "previewTargetEvidence"),
    /s3-static: provider evidence field previewTargetEvidence is unsupported/,
  );

  const opentofu = normalizeProviderEvidenceFacts({
    provider: "opentofu",
    providerReleaseId: "apply-1",
    finalOutcome: "succeeded",
    smokeOutcome: "passed",
    operationKind: "rollback",
    admittedContext: { sourcePlanRef: "source-plan:tf" },
  });
  assert.equal(opentofu.lastKnownProviderReleaseId, "unsupported");
  assert.equal(opentofu.partialPublishEvidence, "unsupported");
  assert.equal(opentofu.smokeReadinessEvidence, "unsupported");
  assert.equal(opentofu.rollbackRecoveryEvidence, "deferred");
  assert.equal(opentofu.sourcePlanRef, undefined);

  const noSourcePlan = normalizeProviderEvidenceFacts({
    provider: "cloudflare-pages",
    admittedContext: { sourcePlanRef: "source-plan:ignored" },
  });
  assert.equal(noSourcePlan.sourcePlanRef, undefined);
});
