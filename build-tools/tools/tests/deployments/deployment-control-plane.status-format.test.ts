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
    executionPolicy: {
      smokeBudget: {
        runnerClass: "http_5m",
        totalBudgetMs: 300000,
        source: "component_kind_default",
      },
      retries: [
        {
          step: "smoke",
          maxRetries: 76,
          totalAttempts: 77,
          retriesUsed: 76,
          exhaustedBudget: true,
          attempts: [
            {
              attempt: 77,
              outcome: "failed",
              reasonCode: "budget_exhausted",
              message: "smoke expected 200 from https://staging.example.test/, got 522",
            },
          ],
        },
      ],
    },
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
  assert.match(
    text,
    /smoke budget: class http_5m \| budget 300000ms \| source component_kind_default/,
  );
  assert.match(
    text,
    /retry: step smoke \| attempts 77\/77 \| retries 76 \| budget exhausted \| last budget_exhausted \| message smoke expected 200 from https:\/\/staging\.example\.test\/, got 522/,
  );
  assert.match(text, /errorFingerprint: sha256:error-1/);
  assert.match(text, /diagnostic: payload redacted \(sha256:error-1\)/);
});
