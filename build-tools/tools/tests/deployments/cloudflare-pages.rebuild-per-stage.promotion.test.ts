#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import {
  nixosSharedHostAdmissionPolicyFixture,
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
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

async function writeWranglerConfig(filePath: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function rebuildLanePolicy() {
  return nixosSharedHostLanePolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:lane",
    name: "lane",
    artifactReuseMode: "rebuild_per_stage",
    fingerprint: "sha256:lane-pleomino-rebuild-per-stage",
  });
}

function rebuildDevDeployment() {
  const lanePolicy = rebuildLanePolicy();
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:dev_release",
    name: "dev_release",
  });
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-rebuild-dev",
    label: "//projects/deployments/pleomino-rebuild-dev:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino-rebuild", containerPort: 3000, healthPath: "/healthz" },
  });
}

function rebuildStagingDeployment() {
  const lanePolicy = rebuildLanePolicy();
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/pleomino-rebuild-shared:staging_release",
    name: "staging_release",
    allowedRefs: ["env/pleomino/staging"],
    requiredChecks: ["deploy/pleomino-staging"],
    fingerprint: "sha256:admission-pleomino-rebuild-staging",
  });
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-rebuild-staging",
    label: "//projects/deployments/pleomino-rebuild-staging:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    providerTarget: {
      account: "web-platform-staging",
      project: "pleomino-rebuild-staging-pages",
      id: "pleomino-rebuild-staging-pages",
      canonicalUrl: "https://pleomino-rebuild-staging-pages.pages.dev/",
      providerTargetIdentity:
        "cloudflare-pages:web-platform-staging/pleomino-rebuild-staging-pages",
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

async function createSourceRun(tmp: string, $: any, recordsRoot: string) {
  const deployment = rebuildDevDeployment();
  const deploymentJson = path.join(tmp, "pleomino-rebuild-dev.json");
  const artifactDir = path.join(tmp, "source-artifact");
  const hostRoot = path.join(tmp, "host");
  const statePath = path.join(tmp, "platform-state.json");
  await writeArtifact(artifactDir, "<html>source release</html>\n");
  await ensureNixosSharedHostStageBranch(tmp, $, deployment);
  await writeDeploymentJson(deploymentJson, deployment);
  const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
  try {
    const run = await $({
      cwd: tmp,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
    const summary = JSON.parse(String(run.stdout));
    const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
    return { deployment, summary, record };
  } finally {
    await server.close();
  }
}

test("cloudflare-pages rebuild-per-stage promotion rejects publish-only exact-artifact reuse", async () => {
  await runInTemp("cloudflare-pages-rebuild-per-stage-guardrail", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const { summary } = await createSourceRun(tmp, $, recordsRoot);
    const staging = rebuildStagingDeployment();
    const stagingJson = path.join(tmp, "pleomino-rebuild-staging.json");
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await writeDeploymentJson(stagingJson, staging);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --publish-only --source-run-id ${summary.deployRunId} --records-root ${recordsRoot}`,
      /requires target-stage rebuild/,
    );
  });
});

test("cloudflare-pages rebuild-per-stage promotion admits a new stage artifact before publish", async () => {
  await runInTemp("cloudflare-pages-rebuild-per-stage-e2e", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const {
      deployment: sourceDeployment,
      summary: sourceSummary,
      record: sourceRecord,
    } = await createSourceRun(tmp, $, recordsRoot);
    const staging = rebuildStagingDeployment();
    const stagingJson = path.join(tmp, "pleomino-rebuild-staging.json");
    const stagingArtifactDir = path.join(tmp, "staging-artifact");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(stagingArtifactDir, "<html>stage-specific build</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-rebuild-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, sourceDeployment);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await writeDeploymentJson(stagingJson, staging);
    const server = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    Object.assign(process.env, fakeCloudflareEnv(fake));
    try {
      const run = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --artifact-dir ${stagingArtifactDir} --source-run-id ${sourceSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(run.stdout));
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      const wranglerLogs = (await fsp.readFile(fake.logPath, "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      assert.equal(summary.operationKind, "promotion");
      assert.equal(summary.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.parentRunId, sourceSummary.deployRunId);
      assert.equal(record.releaseLineageId, sourceSummary.deployRunId);
      assert.notEqual(record.artifact.identity, sourceSummary.artifactIdentity);
      assert.equal(record.artifactLineageId, record.artifact.identity);
      assert.notEqual(record.artifactLineageId, sourceRecord.artifactLineageId);
      assert.equal(record.admittedContext.source.mode, "promotion_source_run");
      assert.equal(record.admittedContext.source.sourceRunId, sourceSummary.deployRunId);
      assert.equal(record.admittedContext.source.sourceDeploymentId, sourceDeployment.deploymentId);
      assert.equal(record.admittedContext.targetEnvironment.targetRef, "env/pleomino/staging");
      assert.equal(snapshot.operationKind, "promotion");
      assert.equal(snapshot.action.publishBehavior, "deploy");
      assert.equal(snapshot.action.sourceRecordPath, sourceSummary.recordPath);
      assert.equal(snapshot.action.sourceReplaySnapshotPath, sourceRecord.replaySnapshotPath);
      assert.equal(wranglerLogs[0]?.artifactDir, record.artifact.storedArtifactPath);
      assert.notEqual(wranglerLogs[0]?.artifactDir, sourceRecord.artifact.storedArtifactPath);
      assert.match(
        await fsp.readFile(
          path.join(fake.publishRoot, staging.providerTarget.project, "index.html"),
          "utf8",
        ),
        /stage-specific build/,
      );
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await server.close();
    }
  });
});
