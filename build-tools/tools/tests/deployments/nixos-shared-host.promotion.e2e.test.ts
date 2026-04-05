#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCrossDeploymentPromotionSelection } from "../../deployments/deployment-promotion.ts";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
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

async function writeDeploymentJson(filePath: string, deployment: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function liveIndexPath(hostRoot: string, containerName: string): string {
  return path.join(
    nixosSharedHostContainerRoot(hostRoot, containerName),
    "srv/static-app/live/index.html",
  );
}

function cloudflareDevDeployment() {
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture();
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-dev-pages",
    label: "//projects/deployments/pleomino-dev-pages:deploy",
    environmentStage: "dev",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    providerTarget: {
      account: "web-platform-dev",
      project: "pleomino-dev-pages",
      id: "pleomino-dev-pages",
      canonicalUrl: "https://pleomino-dev-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-dev/pleomino-dev-pages",
    },
  });
}

function nixosStagingDeployment() {
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//build-tools/deployments/policies:pleomino_staging_release",
    name: "pleomino_staging_release",
    allowedRefs: ["env/pleomino/staging"],
    requiredChecks: ["deploy/pleomino-staging"],
    fingerprint: "sha256:admission-pleomino-staging",
  });
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-staging-host",
    label: "//projects/deployments/pleomino-staging-host:deploy",
    environmentStage: "staging",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino-staging", containerPort: 3000, healthPath: "/healthz" },
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

test("nixos-shared-host promotes a compatible same-artifact source run from cloudflare-pages", async () => {
  await runInTemp("nixos-shared-host-promotion-e2e", async (tmp, $) => {
    const source = cloudflareDevDeployment();
    const target = nixosStagingDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const bootstrapArtifactDir = path.join(tmp, "bootstrap-artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const sourceJson = path.join(tmp, "pleomino-dev-pages.json");
    const targetJson = path.join(tmp, "pleomino-staging-host.json");
    await writeArtifact(artifactDir, "<html>promoted release</html>\n");
    await writeArtifact(bootstrapArtifactDir, "<html>bootstrap</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-dev-pages", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, source);
    await ensureNixosSharedHostStageBranch(tmp, $, target);
    await writeDeploymentJson(sourceJson, source);
    await writeDeploymentJson(targetJson, target);
    const sourceServer = await startCloudflarePagesPublicServer({
      deployment: source,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const targetServer = await startNixosSharedHostPublicServer({ deployment: target, hostRoot });
    try {
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${targetJson} --artifact-dir ${bootstrapArtifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(targetServer.port)} --smoke-connect-protocol https:`;
      const sourceRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${sourceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(sourceServer.port)} --smoke-connect-protocol https:`;
      const sourceSummary = JSON.parse(String(sourceRun.stdout));
      const sourceRecord = JSON.parse(await fsp.readFile(sourceSummary.recordPath, "utf8"));
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const promotionRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${targetJson} --publish-only --source-run-id ${sourceSummary.deployRunId} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(targetServer.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(promotionRun.stdout));
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(summary.operationKind, "promotion");
      assert.equal(summary.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.releaseLineageId, sourceSummary.deployRunId);
      assert.equal(record.artifactLineageId, sourceSummary.artifactIdentity);
      assert.equal(record.artifact.identity, sourceSummary.artifactIdentity);
      assert.equal(record.admittedContext.source.mode, "promotion_source_run");
      assert.equal(record.admittedContext.source.sourceRunId, sourceSummary.deployRunId);
      assert.equal(record.admittedContext.source.sourceDeploymentId, source.deploymentId);
      assert.equal(record.admittedContext.targetEnvironment.targetRef, "env/pleomino/staging");
      assert.equal(snapshot.operationKind, "promotion");
      assert.equal(snapshot.action.publishBehavior, "publish-only");
      assert.equal(snapshot.action.sourceRecordPath, sourceSummary.recordPath);
      assert.equal(snapshot.action.sourceReplaySnapshotPath, sourceRecord.replaySnapshotPath);
      assert.match(
        await fsp.readFile(liveIndexPath(hostRoot, "pleomino-staging"), "utf8"),
        /promoted release/,
      );
    } finally {
      await sourceServer.close();
      await targetServer.close();
    }
  });
});

test("nixos-shared-host promotion rejects retained source runs that drift out of lane eligibility", async () => {
  await runInTemp("nixos-shared-host-promotion-drift", async (tmp, $) => {
    const source = cloudflareDevDeployment();
    const target = nixosStagingDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const sourceJson = path.join(tmp, "pleomino-dev-pages.json");
    await writeArtifact(artifactDir, "<html>eligible source</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-dev-pages", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, source);
    await ensureNixosSharedHostStageBranch(tmp, $, target);
    await writeDeploymentJson(sourceJson, source);
    const sourceServer = await startCloudflarePagesPublicServer({
      deployment: source,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const sourceRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${sourceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(sourceServer.port)} --smoke-connect-protocol https:`;
      const sourceSummary = JSON.parse(String(sourceRun.stdout));
      await $({ cwd: tmp, stdio: "pipe" })`git config user.email test@example.com`;
      await $({ cwd: tmp, stdio: "pipe" })`git config user.name Test`;
      await $({ cwd: tmp, stdio: "pipe" })`git commit --allow-empty -m drift`;
      await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/pleomino/staging HEAD`;
      await assert.rejects(
        resolveCrossDeploymentPromotionSelection({
          workspaceRoot: tmp,
          deployment: target,
          recordsRoot,
          sourceRunId: sourceSummary.deployRunId,
        }),
        /no longer matches current promotable target state/,
      );
    } finally {
      await sourceServer.close();
    }
  });
});
