#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { readAppStoreConnectDeployRecord } from "../../deployments/app-store-connect-records";
import { runInTemp } from "../lib/test-helpers";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  appStoreConnectFakeEnv,
  installAppStoreConnectTargets,
  writeAppStoreConnectConfig,
} from "./app-store-connect.e2e.helpers";
import { mobileReviewedLanePolicy, writeMobileArtifact } from "./mobile-release.e2e.helpers";
import { writeDeploymentJson } from "./nixos-shared-host.reuse.e2e.helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

test("app-store-connect deploy and promotion preserve release-health evidence", async () => {
  await runInTemp("app-store-connect-promotion", async (tmp, $) => {
    const lanePolicy = mobileReviewedLanePolicy();
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
    await writeMobileArtifact(artifactPath, "signed-ios-artifact-v1\n");
    await writeAppStoreConnectConfig(tmp, dev);
    await writeAppStoreConnectConfig(tmp, staging);
    await installAppStoreConnectTargets(tmp, [dev, staging]);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: dev.label,
      deployment: dev,
    });
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: staging.label,
      deployment: staging,
    });
    const env = appStoreConnectFakeEnv(tmp);
    const devRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${dev.label} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactPath} --records-root ${recordsRoot}`;
    const devSummary = JSON.parse(String(devRun.stdout));
    const promotionRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${staging.label} --admission-evidence-json ${stagingEvidenceJson} --publish-only --source-run-id ${devSummary.deployRunId} --records-root ${recordsRoot}`;
    const promotionSummary = JSON.parse(String(promotionRun.stdout));
    const promotionRecord = await readAppStoreConnectDeployRecord(promotionSummary.recordPath);
    assert.equal(promotionRecord.operationKind, "promotion");
    assert.equal(promotionRecord.runnerIdentities.publisher, staging.publisher.type);
    assert.equal(promotionRecord.runnerIdentities.smoke, "app-store-connect-release-health@1");
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
    const lanePolicy = mobileReviewedLanePolicy();
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
    await writeMobileArtifact(artifactA, "signed-ios-artifact-a\n");
    await writeMobileArtifact(artifactB, "signed-ios-artifact-b\n");
    await writeAppStoreConnectConfig(tmp, staging);
    await installAppStoreConnectTargets(tmp, [staging]);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: staging.label,
      deployment: staging,
    });
    const env = appStoreConnectFakeEnv(tmp);
    const runA = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${staging.label} --admission-evidence-json ${stagingEvidenceJson} --artifact-dir ${artifactA} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${staging.label} --admission-evidence-json ${stagingEvidenceJson} --artifact-dir ${artifactB} --records-root ${recordsRoot}`;
    const rollback = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${staging.label} --admission-evidence-json ${stagingEvidenceJson} --publish-only --rollback --source-run-id ${runA.deployRunId} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    const rollbackRecord = await readAppStoreConnectDeployRecord(rollback.recordPath);
    assert.equal(rollbackRecord.operationKind, "rollback");
    assert.equal(rollbackRecord.parentRunId, runA.deployRunId);
    assert.equal(rollbackRecord.runnerIdentities.publisher, staging.publisher.type);
    assert.equal(rollbackRecord.releaseHealth?.status, "healthy");
    assert.equal(rollbackRecord.trackState?.track, "testflight-external");
  });
});
