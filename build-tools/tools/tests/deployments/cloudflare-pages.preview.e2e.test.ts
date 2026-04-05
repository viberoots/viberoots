#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture.ts";
import {
  deriveCloudflarePagesPreviewTarget,
  cloudflarePagesPublishedPath,
} from "../../deployments/cloudflare-pages-preview.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
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

test("cloudflare-pages preview publish and explicit preview cleanup run end to end", async () => {
  await runInTemp("cloudflare-pages-preview-e2e", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino preview</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const normalRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
      const normalSummary = JSON.parse(String(normalRun.stdout));
      await normalServer.close();
      const previewTarget = deriveCloudflarePagesPreviewTarget(
        deployment,
        normalSummary.deployRunId,
      );
      const previewServer = await startCloudflarePagesPublicServer({
        deployment,
        effectiveRunTarget: previewTarget,
        publishRoot: fake.publishRoot,
        tlsRoot: tmp,
      });
      try {
        const previewRun = await $({
          cwd: tmp,
          env: fakeCloudflareEnv(fake),
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --preview --source-run-id ${normalSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(previewServer.port)} --smoke-connect-protocol https:`;
        const previewSummary = JSON.parse(String(previewRun.stdout));
        const previewRecord = JSON.parse(await fsp.readFile(previewSummary.recordPath, "utf8"));
        assert.equal(previewRecord.operationKind, "deploy");
        assert.equal(previewRecord.publishMode, "preview");
        assert.equal(
          previewRecord.providerTargetIdentity,
          "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
        );
        assert.equal(
          previewRecord.effectiveRunTarget.providerTargetIdentity,
          previewTarget.providerTargetIdentity,
        );
        assert.equal(previewRecord.previewIdentitySelector.sourceRunId, normalSummary.deployRunId);
        assert.equal(previewRecord.publicUrl, previewTarget.canonicalUrl);
        assert.equal(
          await fsp
            .access(cloudflarePagesPublishedPath(fake.publishRoot, previewTarget))
            .then(() => "present")
            .catch(() => "missing"),
          "present",
        );
        const wranglerLog = JSON.parse(
          (await fsp.readFile(fake.logPath, "utf8")).trim().split(/\r?\n/).at(-1) || "{}",
        );
        assert.equal(wranglerLog.branch, previewTarget.previewBranch);
        assert.equal(wranglerLog.url, previewTarget.canonicalUrl);
        await previewServer.close();
        const cleanupRun = await $({
          cwd: tmp,
          env: fakeCloudflareEnv(fake),
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --preview-cleanup --source-run-id ${normalSummary.deployRunId} --cleanup-reason manual_cleanup --records-root ${recordsRoot}`;
        const cleanupSummary = JSON.parse(String(cleanupRun.stdout));
        const cleanupRecord = JSON.parse(await fsp.readFile(cleanupSummary.recordPath, "utf8"));
        assert.equal(cleanupRecord.operationKind, "preview_cleanup");
        assert.equal(cleanupRecord.publishMode, "preview");
        assert.equal(cleanupRecord.cleanupReason, "manual_cleanup");
        assert.equal(
          cleanupRecord.effectiveRunTarget.providerTargetIdentity,
          previewTarget.providerTargetIdentity,
        );
        assert.equal(
          await fsp
            .access(cloudflarePagesPublishedPath(fake.publishRoot, previewTarget))
            .then(() => "present")
            .catch(() => "missing"),
          "missing",
        );
      } finally {
        await previewServer.close().catch(() => {});
      }
    } finally {
      await normalServer.close().catch(() => {});
    }
  });
});
