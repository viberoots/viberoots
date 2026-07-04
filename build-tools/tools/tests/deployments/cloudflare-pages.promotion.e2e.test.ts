#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion";
import { stableBuckIsolation } from "../../lib/buck-command-env";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import {
  fakeCloudflareEnv,
  sampleWebappDevDeployment,
  sampleWebappProdDeployment,
  writeDeploymentJson,
  writeWranglerConfig,
} from "./cloudflare-pages.promotion.helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import {
  ensureNixosSharedHostReviewedSourceRef,
  installNixosSharedHostTargets,
} from "./nixos-shared-host.fixture";
import {
  startControlPlaneHarness,
  writeDemoArtifact,
} from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { seedSyntheticTargetStageState } from "./nixos-shared-host.promotion.stage-state.helpers";

let buckQueryNonce = 0;

function freshPromotionEnv(tmp: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const isolation = stableBuckIsolation(
    path.join(tmp, `.cloudflare-promotion-query-${++buckQueryNonce}`),
    "zxtest-cloudflare-promotion",
  );
  const env = {
    ...process.env,
    ...overrides,
    BUCK_ISOLATION_DIR: isolation,
    BUCK_NESTED_ISO: isolation,
    BUCK_ISOLATION_DIR_EXPORTER: isolation,
  };
  return env;
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

test("cloudflare-pages allows reviewed cross-provider same-artifact promotion only on declared edges", async () => {
  await runInTemp("cloudflare-pages-promotion-e2e", async (tmp, $) => {
    const dev = sampleWebappDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const prod = sampleWebappProdDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "sample-webapp-dev.json");
    const stagingJson = path.join(tmp, "sample-webapp-staging.json");
    const prodJson = path.join(tmp, "sample-webapp-prod.json");
    await writeDemoArtifact(artifactDir, "sample-webapp release");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
    );
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "prod", "wrangler.jsonc"),
    );
    await installNixosSharedHostTargets(tmp, [dev]);
    await installCloudflarePagesTargets(tmp, [staging, prod]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, dev);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, prod);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await writeDeploymentJson(prodJson, prod);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: dev.label,
      deployment: dev,
    });
    const originalEnv = { ...process.env };
    const env = freshPromotionEnv(tmp);
    Object.assign(process.env, env);
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
        env,
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${dev.label} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      await seedSyntheticTargetStageState({ recordsRoot, deployment: staging });
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
      restoreProcessEnv(originalEnv);
      await devServer.close();
      await stagingServer.close();
      await prodServer.close();
    }
  });
});

test("cloudflare-pages promotion fails closed when staging smoke blocks the promoted artifact", async () => {
  await runInTemp("cloudflare-pages-promotion-smoke-failure", async (tmp, $) => {
    const dev = sampleWebappDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "sample-webapp-dev.json");
    await writeDemoArtifact(artifactDir, "expected");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
    );
    await installNixosSharedHostTargets(tmp, [dev]);
    await installCloudflarePagesTargets(tmp, [staging]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, dev);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    await writeDeploymentJson(devJson, dev);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: dev.label,
      deployment: dev,
    });
    const originalEnv = { ...process.env };
    const env = freshPromotionEnv(tmp, fakeCloudflareEnv(fake));
    Object.assign(process.env, env);
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
    try {
      const devRun = await $({
        cwd: tmp,
        env,
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${dev.label} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      await seedSyntheticTargetStageState({ recordsRoot, deployment: staging });
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
      restoreProcessEnv(originalEnv);
      await devServer.close();
      await stagingServer.close();
    }
  });
});
