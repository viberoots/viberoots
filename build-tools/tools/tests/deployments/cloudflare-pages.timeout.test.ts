#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveInitialCloudflarePagesAdmittedContext } from "../../deployments/cloudflare-pages-admission.ts";
import { updateCloudflareBackendStep } from "../../deployments/cloudflare-pages-control-plane-backend-execution.ts";
import { effectiveCloudflarePagesSmokeTimeoutMs } from "../../deployments/cloudflare-pages-smoke-retries.ts";
import { runCloudflarePagesStaticDeploy } from "../../deployments/cloudflare-pages-static-deploy.ts";
import { admitStaticWebappArtifact } from "../../deployments/static-webapp-artifacts.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import {
  writeCloudflareServiceArtifact,
  writeWranglerConfig,
} from "./cloudflare-pages.service-flow.helpers.ts";

test("cloudflare backend progress keeps current step and first mutation start", () => {
  const vault = updateCloudflareBackendStep(
    {
      submissionId: "cp-progress",
      lifecycleState: "running",
      lockScope: "cloudflare-pages:test",
      executionSnapshotPath: "/snapshot.json",
    },
    "vault",
    { timeoutMs: 60_000 },
  );
  assert.equal(vault.execution?.currentStep, "vault");
  assert.equal(vault.execution?.timeoutMs, 60_000);
  assert.equal(vault.execution?.mutationStartedAt, undefined);

  const publish = updateCloudflareBackendStep(vault, "publish", {
    mutationStep: true,
    timeoutMs: 25,
  });
  assert.equal(publish.execution?.currentStep, "publish");
  assert.equal(publish.execution?.timeoutMs, 25);
  assert.ok(publish.execution?.mutationStartedAt);
});

test("cloudflare smoke timeout cannot shorten the deployment smoke policy budget", () => {
  assert.equal(
    effectiveCloudflarePagesSmokeTimeoutMs({
      workerTimeoutMs: 3_000,
      policyBudgetMs: 5 * 60_000,
    }),
    5 * 60_000,
  );
  assert.equal(
    effectiveCloudflarePagesSmokeTimeoutMs({
      workerTimeoutMs: 10 * 60_000,
      policyBudgetMs: 5 * 60_000,
    }),
    10 * 60_000,
  );
});

test("cloudflare-pages publish timeout records the failed step and reports progress", async () => {
  await runInTemp("cloudflare-pages-publish-timeout", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeCloudflareServiceArtifact(artifactDir, "<html>timeout</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const artifact = await admitStaticWebappArtifact({
      recordsRoot,
      artifactDir,
      producer: { producerKind: "local_direct" },
    });
    const admittedContext = await resolveInitialCloudflarePagesAdmittedContext({
      workspaceRoot: tmp,
      deployment,
      artifactIdentity: artifact.identity,
    });
    const originalEnv = { ...process.env };
    const progress: Array<{ step: string; timeoutMs?: number }> = [];
    process.env.PATH = `${fake.binDir}:${originalEnv.PATH || ""}`;
    process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG = fake.logPath;
    process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_DELAY_MS = "250";
    process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN = path.join(fake.binDir, "wrangler");
    try {
      await assert.rejects(
        async () =>
          await runCloudflarePagesStaticDeploy({
            workspaceRoot: tmp,
            deployment,
            artifact,
            recordsRoot,
            admittedContext,
            authority: {
              kind: "control-plane-worker",
              submissionId: "cp-timeout",
              workerId: "worker-timeout",
              lockScope: deployment.providerTarget.providerTargetIdentity,
              executionSnapshotPath: path.join(tmp, "execution-snapshot.json"),
            },
            progress: {
              onStepStart: (step, metadata) => {
                progress.push({ step, ...(metadata?.timeoutMs ? metadata : {}) });
              },
            },
            timeouts: { publishMs: 25 },
          }),
        /publish|timeout|SIGTERM/i,
      );
      assert.deepEqual(progress, [{ step: "publish", timeoutMs: 25 }]);
      const runFiles = await fsp.readdir(path.join(recordsRoot, "runs"));
      assert.equal(runFiles.length, 1);
      const record = JSON.parse(
        await fsp.readFile(path.join(recordsRoot, "runs", runFiles[0] || ""), "utf8"),
      );
      assert.equal(record.finalOutcome, "publish_failed");
      assert.equal(record.failedStep, "publish");
      assert.match(record.error, /publish|timeout|SIGTERM/i);
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_DELAY_MS;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
    }
  });
});
