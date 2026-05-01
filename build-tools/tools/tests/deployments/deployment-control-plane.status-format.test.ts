#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDeploymentControlPlaneRecordText } from "../../deployments/deployment-control-plane-status-format.ts";

test("record text includes failure and control-plane context", () => {
  const text = formatDeploymentControlPlaneRecordText({
    deployRunId: "deploy-run-failed",
    finalOutcome: "smoke_failed_after_publish",
    failedStep: "smoke",
    deploymentLabel: "//sandbox/deployments/demo-dev:deploy",
    providerTargetIdentity: "cloudflare-pages:account/pages",
    publicUrl: "https://staging.example.test/",
    providerReleaseId: "cf-deploy-123",
    artifact: { identity: "static-webapp:abc123" },
    smokeOutcome: "failed_nonblocking",
    error: "payload redacted (sha256:error-1)",
    errorFingerprint: "sha256:error-1",
    controlPlane: {
      submissionId: "submission-failed",
      workerId: "worker-failed",
      lockScope: "cloudflare-pages:account/pages",
    },
  });

  assert.match(text, /record: deploy-run-failed/);
  assert.match(text, /outcome: smoke_failed_after_publish/);
  assert.match(text, /failed step: smoke/);
  assert.match(text, /submissionId: submission-failed/);
  assert.match(text, /workerId: worker-failed/);
  assert.match(text, /target: cloudflare-pages:account\/pages/);
  assert.match(text, /publicUrl: https:\/\/staging\.example\.test\//);
  assert.match(text, /providerReleaseId: cf-deploy-123/);
  assert.match(text, /artifact: static-webapp:abc123/);
  assert.match(text, /smoke: failed_nonblocking/);
  assert.match(text, /errorFingerprint: sha256:error-1/);
  assert.match(text, /diagnostic: payload redacted \(sha256:error-1\)/);
});
