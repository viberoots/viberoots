#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import {
  reviewedLaneAdmissionEvidenceFixture,
  writeReviewedLaneAdmissionEvidenceJson,
} from "./deployment-lane-governance.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(
  root: string,
  raw = '{\n  "compatibility_date": "2026-03-18"\n}\n',
) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, raw, "utf8");
}

test("cloudflare-pages deploy CLI completes the static-webapp flow end to end", async () => {
  await runInTemp("cloudflare-pages-e2e", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "test-workspace", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
          BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
          BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
        },
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.operationKind, "deploy");
      assert.equal(summary.runClassification, "deploy");
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://pleomino-staging-pages.pages.dev/");
      assert.equal(
        summary.controlPlane.lockScope,
        "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
      );
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.provider, "cloudflare-pages");
      assert.equal(
        record.providerTargetIdentity,
        "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
      );
      assert.equal(record.artifact.identity, summary.artifactIdentity);
      assert.equal(record.providerReleaseId, "cloudflare-pages-deployment-01TEST");
      assert.match(record.deploymentMetadataFingerprint, /^sha256:/);
      assert.match(record.providerConfigFingerprint, /^sha256:/);
      const wranglerLog = JSON.parse(
        (await fsp.readFile(fake.logPath, "utf8")).trim().split(/\r?\n/).at(-1) || "{}",
      );
      assert.equal(wranglerLog.projectName, "pleomino-staging-pages");
      assert.equal(wranglerLog.accountId, "web-platform-staging");
      assert.equal(wranglerLog.config.name, "pleomino-staging-pages");
    } finally {
      await server.close();
    }
  });
});

test("cloudflare-pages smoke failure blocks success after publish", async () => {
  await runInTemp("cloudflare-pages-smoke-failure", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const wrongPublishRoot = path.join(tmp, "wrong-public");
    await writeArtifact(artifactDir, "<html>expected</html>\n");
    await writeArtifact(
      path.join(wrongPublishRoot, deployment.providerTarget.project),
      "<html>wrong</html>\n",
    );
    await writeWranglerConfig(
      path.join(tmp, "test-workspace", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: wrongPublishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    process.env.PATH = `${fake.binDir}:${originalEnv.PATH || ""}`;
    process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG = fake.logPath;
    process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN = path.join(fake.binDir, "wrangler");
    try {
      await assert.rejects(
        async () =>
          await submitCloudflarePagesControlPlaneDeploy({
            workspaceRoot: tmp,
            deployment,
            artifactDir,
            recordsRoot,
            admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
            smokeConnectOverride: {
              protocol: "https:",
              hostname: "127.0.0.1",
              port: server.port,
              rejectUnauthorized: false,
            },
          }),
        /smoke content mismatch/,
      );
      const runFiles = await fsp.readdir(path.join(recordsRoot, "runs"));
      assert.equal(runFiles.length, 1);
      const record = JSON.parse(
        await fsp.readFile(path.join(recordsRoot, "runs", runFiles[0] || ""), "utf8"),
      );
      assert.equal(record.finalOutcome, "smoke_failed_after_publish");
      assert.equal(record.failedStep, "smoke");
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await server.close();
    }
  });
});

test("cloudflare-pages smoke retries transient readiness failures within the shared budget", async () => {
  await runInTemp("cloudflare-pages-smoke-retry", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      smoke: { timeoutBudgetMs: 1000 },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>retry-me</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "test-workspace", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    let requests = 0;
    const expectedRoot = path.join(tmp, "expected-root");
    const wrongRoot = path.join(tmp, "wrong-root");
    await writeArtifact(expectedRoot, "<html>retry-me</html>\n");
    await writeArtifact(wrongRoot, "<html>not-yet</html>\n");
    const server = await startStaticWebappHttpsServer({
      hostname: new URL(deployment.providerTarget.canonicalUrl).hostname,
      root: () => {
        requests += 1;
        return requests === 1 ? wrongRoot : expectedRoot;
      },
      tlsRoot: tmp,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
          BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
          BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
        },
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.executionPolicy.smokeBudget.totalBudgetMs, 1000);
      assert.equal(summary.executionPolicy.retries.at(-1).retriesUsed, 1);
    } finally {
      await server.close();
    }
  });
});
