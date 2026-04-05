#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function pleominoDevDeployment() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino-dev:deploy",
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
  });
}

function pleominoProdDeployment() {
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//build-tools/deployments/policies:pleomino_prod_release",
    name: "pleomino_prod_release",
    allowedRefs: ["env/pleomino/prod"],
    requiredChecks: ["deploy/pleomino-prod"],
    fingerprint: "sha256:admission-pleomino-prod",
  });
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-prod",
    label: "//projects/deployments/pleomino-prod:deploy",
    protectionClass: "production_facing",
    environmentStage: "prod",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    providerTarget: {
      account: "web-platform-prod",
      project: "pleomino-prod-pages",
      id: "pleomino-prod-pages",
      canonicalUrl: "https://pleomino-prod-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-prod/pleomino-prod-pages",
    },
  });
}

function fakeCloudflareEnv(fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>) {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

test("pleomino promotes the same exact static-webapp artifact from dev to staging to prod", async () => {
  await runInTemp("cloudflare-pages-promotion-e2e", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture();
    const prod = pleominoProdDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    const stagingJson = path.join(tmp, "pleomino-staging.json");
    const prodJson = path.join(tmp, "pleomino-prod.json");
    await writeArtifact(artifactDir, "<html>pleomino release</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-prod", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, prod);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await writeDeploymentJson(prodJson, prod);
    const devServer = await startNixosSharedHostPublicServer({ deployment: dev, hostRoot });
    const stagingServer = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const prodServer = await startCloudflarePagesPublicServer({
      deployment: prod,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const devRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${devJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const devRecord = JSON.parse(await fsp.readFile(devSummary.recordPath, "utf8"));
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const stagingRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --publish-only --source-run-id ${devSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(stagingServer.port)} --smoke-connect-protocol https:`;
      const stagingSummary = JSON.parse(String(stagingRun.stdout));
      const stagingRecord = JSON.parse(await fsp.readFile(stagingSummary.recordPath, "utf8"));
      const prodRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${prodJson} --publish-only --source-run-id ${stagingSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(prodServer.port)} --smoke-connect-protocol https:`;
      const prodSummary = JSON.parse(String(prodRun.stdout));
      const prodRecord = JSON.parse(await fsp.readFile(prodSummary.recordPath, "utf8"));
      const wranglerLogs = (await fsp.readFile(fake.logPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(devSummary.operationKind, "deploy");
      assert.equal(stagingSummary.operationKind, "promotion");
      assert.equal(prodSummary.operationKind, "promotion");
      assert.equal(stagingRecord.parentRunId, devSummary.deployRunId);
      assert.equal(stagingRecord.releaseLineageId, devSummary.deployRunId);
      assert.equal(stagingRecord.artifactLineageId, devSummary.artifactIdentity);
      assert.equal(prodRecord.parentRunId, stagingSummary.deployRunId);
      assert.equal(prodRecord.releaseLineageId, devSummary.deployRunId);
      assert.equal(prodRecord.artifactLineageId, devSummary.artifactIdentity);
      assert.equal(stagingRecord.artifact.identity, devSummary.artifactIdentity);
      assert.equal(prodRecord.artifact.identity, devSummary.artifactIdentity);
      assert.equal(wranglerLogs[0]?.artifactDir, devRecord.artifact.storedArtifactPath);
      assert.equal(wranglerLogs[1]?.artifactDir, devRecord.artifact.storedArtifactPath);
      assert.equal(wranglerLogs[0]?.projectName, "pleomino-staging-pages");
      assert.equal(wranglerLogs[1]?.projectName, "pleomino-prod-pages");
    } finally {
      await devServer.close();
      await stagingServer.close();
      await prodServer.close();
    }
  });
});

test("cloudflare-pages promotion fails closed when staging smoke blocks the promoted artifact", async () => {
  await runInTemp("cloudflare-pages-promotion-smoke-failure", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    await writeArtifact(artifactDir, "<html>expected</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await writeDeploymentJson(devJson, dev);
    const devServer = await startNixosSharedHostPublicServer({ deployment: dev, hostRoot });
    const wrongPublishRoot = path.join(tmp, "wrong-public");
    await writeArtifact(
      path.join(wrongPublishRoot, staging.providerTarget.project),
      "<html>wrong</html>\n",
    );
    const stagingServer = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: wrongPublishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    Object.assign(process.env, fakeCloudflareEnv(fake));
    try {
      const devRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${devJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const promotion = await resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: devSummary.deployRunId,
      });
      await assert.rejects(
        async () =>
          await submitCloudflarePagesControlPlaneDeploy({
            workspaceRoot: tmp,
            deployment: staging,
            recordsRoot,
            operationKind: "promotion",
            artifact: promotion.artifact,
            publishBehavior: "publish-only",
            parentRunId: promotion.parentRunId,
            releaseLineageId: promotion.releaseLineageId,
            artifactLineageId: promotion.artifactLineageId,
            source: {
              record: promotion.sourceRecord,
              recordPath: promotion.sourceRecordPath,
              replaySnapshotPath: promotion.sourceReplaySnapshotPath,
            },
            smokeConnectOverride: {
              protocol: "https:",
              hostname: "127.0.0.1",
              port: stagingServer.port,
              rejectUnauthorized: false,
            },
          }),
        /smoke content mismatch/,
      );
      const records = await Promise.all(
        (await fsp.readdir(path.join(recordsRoot, "runs")))
          .sort()
          .map(async (name) =>
            JSON.parse(await fsp.readFile(path.join(recordsRoot, "runs", name), "utf8")),
          ),
      );
      const failedPromotion = records.find((record) => record.operationKind === "promotion");
      assert.equal(failedPromotion?.finalOutcome, "smoke_failed_after_publish");
      assert.equal(failedPromotion?.parentRunId, devSummary.deployRunId);
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await devServer.close();
      await stagingServer.close();
    }
  });
});
