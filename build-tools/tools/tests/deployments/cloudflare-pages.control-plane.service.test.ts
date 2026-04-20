#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
  cloudflarePagesPreviewFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture.ts";
import { DEPLOYMENT_SECRET_FIXTURE_SCHEMA } from "../../deployments/deployment-secret-fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { deriveCloudflarePagesPreviewTarget } from "../../deployments/cloudflare-pages-preview.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  readRecord,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

async function writeSecretFixture(filePath: string) {
  await fsp.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
        contracts: {
          "secret://deployments/pleomino/cloudflare_api_token": {
            value: "service-secret-token",
            allowedSteps: ["publish", "preview_cleanup"],
            targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function fakeCloudflareOverrides(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
  fixturePath?: string,
): Record<string, string> {
  const overrides: Record<string, string> = {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
  if (fixturePath) overrides.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH = fixturePath;
  return overrides;
}

test("public cloudflare-pages deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("cloudflare-pages-public-service-required", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir, "<html>service-required</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    await assert.rejects(
      $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${admissionEvidenceJson}`,
      /cloudflare-pages (shared_nonprod|production_facing) mutation requires --control-plane-url or BNX_DEPLOY_CONTROL_PLANE_URL/,
    );
  });
});

test("public cloudflare-pages deploy rejects mixed service and local records flags", async () => {
  await runInTemp("cloudflare-pages-public-service-mixed-flags", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir, "<html>mixed-mode</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    try {
      await assert.rejects(
        $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${admissionEvidenceJson} --control-plane-url ${harness.controlPlane.url} --records-root ${recordsRoot}`,
        /service-only cloudflare-pages deploy does not support --records-root/,
      );
    } finally {
      await harness.close();
    }
  });
});

test("public cloudflare-pages deploy routes deploy, preview, cleanup, and rollback through the control-plane service", async () => {
  await runInTemp("cloudflare-pages-public-service-flow", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
      secretRequirements: cloudflarePagesApiTokenRequirements(),
    });
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const fixturePath = path.join(tmp, "secret-fixture.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactA, "<html>artifact-a</html>\n");
    await writeArtifact(artifactB, "<html>artifact-b</html>\n");
    await writeSecretFixture(fixturePath);
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    let previewServer: Awaited<ReturnType<typeof startCloudflarePagesPublicServer>> | undefined;
    try {
      const env = { ...process.env, ...fakeCloudflareOverrides(fake, fixturePath) };
      await withEnvOverrides(fakeCloudflareOverrides(fake, fixturePath), async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot,
          statePath,
          recordsRoot,
        });
        try {
          const firstRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactA} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const firstSummary = JSON.parse(String(firstRun.stdout));
          assert.equal(firstSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in firstSummary, false);
          const firstRecord = await readRecord(harness.controlPlane.url, firstSummary.deployRunId);
          assert.equal("submissionPath" in (firstRecord.controlPlane || {}), false);
          assert.equal("executionSnapshotPath" in (firstRecord.controlPlane || {}), false);

          previewServer = await startCloudflarePagesPublicServer({
            deployment,
            publishRoot: fake.publishRoot,
            effectiveRunTarget: deriveCloudflarePagesPreviewTarget(
              deployment,
              firstSummary.deployRunId,
            ),
            tlsRoot: tmp,
          });
          const previewRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview --source-run-id ${firstSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(previewServer.port)} --smoke-connect-protocol https:`;
          const previewSummary = JSON.parse(String(previewRun.stdout));
          assert.equal(previewSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in previewSummary, false);

          const cleanupRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --preview-cleanup --source-run-id ${firstSummary.deployRunId} --cleanup-reason manual_cleanup --control-plane-url ${harness.controlPlane.url}`;
          const cleanupSummary = JSON.parse(String(cleanupRun.stdout));
          assert.equal(cleanupSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in cleanupSummary, false);

          const secondRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactB} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const secondSummary = JSON.parse(String(secondRun.stdout));
          assert.equal(secondSummary.finalOutcome, "succeeded");

          const rollbackRun = await $({
            cwd: tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${firstSummary.deployRunId} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
          const rollbackSummary = JSON.parse(String(rollbackRun.stdout));
          assert.equal(rollbackSummary.finalOutcome, "succeeded");
          assert.equal("recordPath" in rollbackSummary, false);
        } finally {
          await harness.close();
        }
      });
    } finally {
      if (previewServer) await previewServer.close();
      await normalServer.close();
    }
  });
});
