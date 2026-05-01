#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySmokeRetry,
  defaultMaxRetriesForStep,
  noPublishAutoRetry,
  runWithAutomaticRetry,
} from "../../deployments/deployment-retry-policy.ts";
import { resolveDeploymentSmokeBudget } from "../../deployments/deployment-smoke-budget.ts";
import { maxCloudflarePagesCustomDomainSmokeRetries } from "../../deployments/cloudflare-pages-smoke-retries.ts";

test("lifecycle retry policy keeps validate, build, resolve, and provision on a fail-first path", () => {
  assert.equal(defaultMaxRetriesForStep("validate"), 0);
  assert.equal(defaultMaxRetriesForStep("build"), 0);
  assert.equal(defaultMaxRetriesForStep("resolve"), 0);
  assert.equal(defaultMaxRetriesForStep("provision"), 0);
  assert.equal(defaultMaxRetriesForStep("publish"), 2);
  assert.equal(defaultMaxRetriesForStep("smoke"), 2);
});

test("publish auto-retry fails closed when duplicate-execution safety is not proven", async () => {
  await assert.rejects(
    async () =>
      await runWithAutomaticRetry({
        step: "publish",
        run: async () => {
          throw new Error("provider returned ambiguous publish result");
        },
        classifyError: () => noPublishAutoRetry(),
      }),
    (error: any) => {
      assert.equal(error.retryAudit.totalAttempts, 1);
      assert.equal(error.retryAudit.retriesUsed, 0);
      assert.equal(error.retryAudit.attempts[0]?.reasonCode, "publish_not_proven_safe");
      return true;
    },
  );
});

test("smoke retries stay within the total timeout budget and preserve retry facts", async () => {
  let attempts = 0;
  const result = await runWithAutomaticRetry({
    step: "smoke",
    totalBudgetMs: 500,
    run: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("smoke expected 200 from https://demoapp.apps.kilty.io/, got 404");
      }
      return "passed";
    },
    classifyError: classifySmokeRetry,
  });
  assert.equal(result.result, "passed");
  assert.equal(result.audit.retriesUsed, 2);
  assert.equal(result.audit.totalAttempts, 3);
  assert.equal(result.audit.attempts[0]?.reasonCode, "smoke_readiness_transient");
});

test("smoke budget defaults derive from component kind or explicit metadata", () => {
  assert.deepEqual(resolveDeploymentSmokeBudget({ componentKind: "static-webapp" }), {
    runnerClass: "http_5m",
    totalBudgetMs: 300000,
    source: "component_kind_default",
  });
  assert.deepEqual(
    resolveDeploymentSmokeBudget({
      componentKind: "static-webapp",
      smoke: { runnerClass: "http_10m", timeoutBudgetMs: 120000 },
    }),
    {
      runnerClass: "http_10m",
      totalBudgetMs: 120000,
      source: "deployment_metadata.timeout_budget_ms",
    },
  );
  assert.deepEqual(resolveDeploymentSmokeBudget({ componentKind: "mobile-app" }), {
    runnerClass: "release_health",
    totalBudgetMs: undefined,
    source: "component_kind_default",
  });
});

test("cloudflare custom-domain smoke retry cap allows the timeout budget to decide", () => {
  assert.equal(maxCloudflarePagesCustomDomainSmokeRetries(1000), 4);
  assert.equal(maxCloudflarePagesCustomDomainSmokeRetries(5 * 60 * 1000), 76);
  assert.equal(maxCloudflarePagesCustomDomainSmokeRetries(10 * 60 * 1000), 109);
});
