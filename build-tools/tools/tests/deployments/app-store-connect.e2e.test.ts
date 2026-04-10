#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readAppStoreConnectDeployRecord } from "../../deployments/app-store-connect-records.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture.ts";

async function writeArtifact(filePath: string, contents: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents, "utf8");
}

async function writeConfig(
  workspaceRoot: string,
  deployment: ReturnType<typeof appStoreConnectDeploymentFixture>,
) {
  const packageDir = path.join(workspaceRoot, "projects", "deployments", deployment.deploymentId);
  await fsp.mkdir(packageDir, { recursive: true });
  await fsp.writeFile(
    path.join(packageDir, "app-store-connect.jsonc"),
    JSON.stringify(
      {
        issuer: deployment.providerTarget.issuer,
        app: deployment.providerTarget.app,
        bundle_id: deployment.providerTarget.bundleId,
        track: deployment.providerTarget.track,
        signing_model: deployment.providerTarget.signingModel,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("app-store-connect deploy and promotion preserve release-health evidence", async () => {
  await runInTemp("app-store-connect-promotion", async (tmp, $) => {
    const lanePolicy = nixosSharedHostLanePolicyFixture({
      stageBranches: {
        dev: "env/mobile/dev",
        staging: "env/mobile/staging",
        prod: "env/mobile/prod",
      },
    });
    const dev = appStoreConnectDeploymentFixture({
      deploymentId: "demo-ios-dev",
      label: "//projects/deployments/demo-ios-dev:deploy",
      lanePolicy,
      providerTarget: {
        issuer: "ios-platform",
        app: "demo-ios-app",
        bundleId: "com.example.demo",
        platform: "ios",
        track: "testflight-internal",
        signingModel: "app-store",
        providerTargetIdentity:
          "app-store-connect:ios-platform/demo-ios-app#track:testflight-internal",
      },
    });
    const staging = appStoreConnectDeploymentFixture({
      deploymentId: "demo-ios-staging",
      label: "//projects/deployments/demo-ios-staging:deploy",
      environmentStage: "staging",
      lanePolicy,
      providerTarget: {
        issuer: "ios-platform",
        app: "demo-ios-app",
        bundleId: "com.example.demo",
        platform: "ios",
        track: "testflight-external",
        signingModel: "app-store",
        providerTargetIdentity:
          "app-store-connect:ios-platform/demo-ios-app#track:testflight-external",
      },
    });
    const recordsRoot = path.join(tmp, "records");
    const artifactPath = path.join(tmp, "artifacts", "demo.ipa");
    const devJson = path.join(tmp, "dev.json");
    const stagingJson = path.join(tmp, "staging.json");
    await writeArtifact(artifactPath, "signed-ios-artifact-v1\n");
    await writeConfig(tmp, dev);
    await writeConfig(tmp, staging);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const env = {
      ...process.env,
      BNX_APP_STORE_CONNECT_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
    };
    const devRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${devJson} --artifact-dir ${artifactPath} --records-root ${recordsRoot}`;
    const devSummary = JSON.parse(String(devRun.stdout));
    const promotionRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --publish-only --source-run-id ${devSummary.deployRunId} --records-root ${recordsRoot}`;
    const promotionSummary = JSON.parse(String(promotionRun.stdout));
    const promotionRecord = await readAppStoreConnectDeployRecord(promotionSummary.recordPath);
    assert.equal(promotionRecord.operationKind, "promotion");
    assert.equal(promotionRecord.releaseHealth?.status, "healthy");
    assert.equal(promotionRecord.releaseHealth?.processingStatus, "processed");
    assert.equal(promotionRecord.trackState?.track, "testflight-external");
    assert.equal(promotionRecord.trackState?.promotedFromTrack, "testflight-internal");
    assert.equal(promotionRecord.rolloutState?.mode, "all_at_once");
    assert.equal(promotionRecord.artifact?.identity.startsWith("mobile-app:"), true);
  });
});

test("app-store-connect rollback reuses a prior successful exact artifact", async () => {
  await runInTemp("app-store-connect-rollback", async (tmp, $) => {
    const lanePolicy = nixosSharedHostLanePolicyFixture({
      stageBranches: {
        dev: "env/mobile/dev",
        staging: "env/mobile/staging",
        prod: "env/mobile/prod",
      },
    });
    const staging = appStoreConnectDeploymentFixture({
      deploymentId: "demo-ios-staging",
      label: "//projects/deployments/demo-ios-staging:deploy",
      environmentStage: "staging",
      lanePolicy,
      admissionPolicy: undefined,
      providerTarget: {
        issuer: "ios-platform",
        app: "demo-ios-app",
        bundleId: "com.example.demo",
        platform: "ios",
        track: "testflight-external",
        signingModel: "app-store",
        providerTargetIdentity:
          "app-store-connect:ios-platform/demo-ios-app#track:testflight-external",
      },
    });
    const recordsRoot = path.join(tmp, "records");
    const artifactA = path.join(tmp, "artifacts", "a.ipa");
    const artifactB = path.join(tmp, "artifacts", "b.ipa");
    const stagingJson = path.join(tmp, "staging.json");
    await writeArtifact(artifactA, "signed-ios-artifact-a\n");
    await writeArtifact(artifactB, "signed-ios-artifact-b\n");
    await writeConfig(tmp, staging);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const env = {
      ...process.env,
      BNX_APP_STORE_CONNECT_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
    };
    const runA = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --artifact-dir ${artifactA} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --artifact-dir ${artifactB} --records-root ${recordsRoot}`;
    const rollback = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --publish-only --rollback --source-run-id ${runA.deployRunId} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    const rollbackRecord = await readAppStoreConnectDeployRecord(rollback.recordPath);
    assert.equal(rollbackRecord.operationKind, "rollback");
    assert.equal(rollbackRecord.parentRunId, runA.deployRunId);
    assert.equal(rollbackRecord.releaseHealth?.status, "healthy");
    assert.equal(rollbackRecord.trackState?.track, "testflight-external");
  });
});
