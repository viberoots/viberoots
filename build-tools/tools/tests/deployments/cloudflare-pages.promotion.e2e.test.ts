#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import {
  fakeCloudflareEnv,
  pleominoDevDeployment,
  pleominoProdDeployment,
  writeDeploymentJson,
  writeWranglerConfig,
} from "./cloudflare-pages.promotion.helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import {
  ensureNixosSharedHostStageBranch,
  installNixosSharedHostTargets,
} from "./nixos-shared-host.fixture";
import {
  startControlPlaneHarness,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

test("cloudflare-pages allows reviewed cross-provider same-artifact promotion only on declared edges", async () => {
  await runInTemp("cloudflare-pages-promotion-e2e", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const prod = pleominoProdDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    const stagingJson = path.join(tmp, "pleomino-staging.json");
    const prodJson = path.join(tmp, "pleomino-prod.json");
    await writeDemoArtifact(artifactDir, "pleomino release");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-prod", "wrangler.jsonc"),
    );
    await installNixosSharedHostTargets(tmp, [dev]);
    await installCloudflarePagesTargets(tmp, [staging, prod]);
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, prod);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await writeDeploymentJson(prodJson, prod);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: dev.label,
      deployment: dev,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
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
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${dev.label} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const stagingPromotion = await resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: devSummary.deployRunId,
        backendDatabaseUrl: harness.backendDatabaseUrl,
      });
      assert.equal(stagingPromotion.operationKind, "promotion");
      assert.equal(stagingPromotion.parentRunId, devSummary.deployRunId);
      await assert.rejects(
        resolveCloudflarePagesPromotionSelection({
          workspaceRoot: tmp,
          deployment: prod,
          recordsRoot,
          sourceRunId: devSummary.deployRunId,
          backendDatabaseUrl: harness.backendDatabaseUrl,
        }),
        /promotion edge is not allowed by the current lane policy/,
      );
    } finally {
      await harness.close();
      await devServer.close();
      await stagingServer.close();
      await prodServer.close();
    }
  });
});

test("cloudflare-pages promotion fails closed when staging smoke blocks the promoted artifact", async () => {
  await runInTemp("cloudflare-pages-promotion-smoke-failure", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    await writeDemoArtifact(artifactDir, "expected");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installNixosSharedHostTargets(tmp, [dev]);
    await installCloudflarePagesTargets(tmp, [staging]);
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await writeDeploymentJson(devJson, dev);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: dev.label,
      deployment: dev,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    const devServer = await startNixosSharedHostPublicServer({ deployment: dev, hostRoot });
    const wrongPublishRoot = path.join(tmp, "wrong-public");
    await writeDemoArtifact(path.join(wrongPublishRoot, staging.providerTarget.project), "wrong");
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
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${dev.label} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const promotion = await resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: devSummary.deployRunId,
        backendDatabaseUrl: harness.backendDatabaseUrl,
      });
      assert.equal(promotion.operationKind, "promotion");
      const records = await Promise.all(
        (await fsp.readdir(path.join(recordsRoot, "runs")))
          .sort()
          .map(async (name) =>
            JSON.parse(await fsp.readFile(path.join(recordsRoot, "runs", name), "utf8")),
          ),
      );
      const failedPromotion = records.find((record) => record.operationKind === "promotion");
      assert.equal(failedPromotion, undefined);
    } finally {
      await harness.close();
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.VBR_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.VBR_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await devServer.close();
      await stagingServer.close();
    }
  });
});
