#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { readGooglePlayDeployRecord } from "../../deployments/google-play-records";
import { runInTemp } from "../lib/test-helpers";
import { googlePlayDeploymentFixture } from "./google-play.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  googlePlayFakeEnv,
  installGooglePlayTargets,
  writeGooglePlayConfig,
} from "./google-play.e2e.helpers";
import { mobileReviewedLanePolicy, writeMobileArtifact } from "./mobile-release.e2e.helpers";
import { writeDeploymentJson } from "./nixos-shared-host.reuse.e2e.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

test("google-play deploy and promotion preserve release-health evidence", async () => {
  await runInTemp("google-play-promotion", async (tmp, $) => {
    const lanePolicy = mobileReviewedLanePolicy();
    const dev = googlePlayDeploymentFixture({
      deploymentId: "demo-android-dev",
      label: "//projects/deployments/demo-android-dev:deploy",
      lanePolicy,
      providerTarget: {
        developerAccount: "android-platform",
        app: "demo-android-app",
        packageName: "com.example.demo.android",
        platform: "android",
        track: "internal",
        signingModel: "play-app-signing",
        providerTargetIdentity: "google-play:android-platform/demo-android-app#track:internal",
      },
    });
    const staging = googlePlayDeploymentFixture({
      deploymentId: "demo-android-staging",
      label: "//projects/deployments/demo-android-staging:deploy",
      environmentStage: "staging",
      lanePolicy,
      rolloutPolicy: {
        mode: "store_staged",
        abort: "stop_on_first_failure",
        smoke: "final_only",
        steps: ["default"],
      },
      providerTarget: {
        developerAccount: "android-platform",
        app: "demo-android-app",
        packageName: "com.example.demo.android",
        platform: "android",
        track: "beta",
        signingModel: "play-app-signing",
        providerTargetIdentity: "google-play:android-platform/demo-android-app#track:beta",
      },
    });
    const recordsRoot = path.join(tmp, "records");
    const artifactPath = path.join(tmp, "artifacts", "demo.aab");
    const devJson = path.join(tmp, "dev.json");
    const stagingJson = path.join(tmp, "staging.json");
    await writeMobileArtifact(artifactPath, "signed-android-artifact-v1\n");
    await writeGooglePlayConfig(tmp, dev);
    await writeGooglePlayConfig(tmp, staging);
    await installGooglePlayTargets(tmp, [dev, staging]);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, dev);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
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
    const env = googlePlayFakeEnv(tmp);
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
    const promotionRecord = await readGooglePlayDeployRecord(promotionSummary.recordPath);
    assert.equal(promotionRecord.operationKind, "promotion");
    assert.equal(promotionRecord.runnerIdentities.publisher, staging.publisher.type);
    assert.equal(promotionRecord.runnerIdentities.smoke, "google-play-release-health@1");
    assert.equal(promotionRecord.releaseHealth?.status, "healthy");
    assert.equal(promotionRecord.releaseHealth?.processingStatus, "processed");
    assert.equal(promotionRecord.trackState?.track, "beta");
    assert.equal(promotionRecord.trackState?.promotedFromTrack, "internal");
    assert.equal(promotionRecord.rolloutState?.mode, "store_staged");
    assert.equal(promotionRecord.rolloutState?.rolloutFractionPercent, 50);
    assert.equal(promotionRecord.artifact?.identity.startsWith("mobile-app:"), true);
  });
});

test("google-play rollback reuses a prior successful exact artifact", async () => {
  await runInTemp("google-play-rollback", async (tmp, $) => {
    const lanePolicy = mobileReviewedLanePolicy();
    const staging = googlePlayDeploymentFixture({
      deploymentId: "demo-android-staging",
      label: "//projects/deployments/demo-android-staging:deploy",
      environmentStage: "staging",
      lanePolicy,
      admissionPolicy: undefined,
      providerTarget: {
        developerAccount: "android-platform",
        app: "demo-android-app",
        packageName: "com.example.demo.android",
        platform: "android",
        track: "beta",
        signingModel: "play-app-signing",
        providerTargetIdentity: "google-play:android-platform/demo-android-app#track:beta",
      },
    });
    const recordsRoot = path.join(tmp, "records");
    const artifactA = path.join(tmp, "artifacts", "a.aab");
    const artifactB = path.join(tmp, "artifacts", "b.aab");
    const stagingJson = path.join(tmp, "staging.json");
    await writeMobileArtifact(artifactA, "signed-android-artifact-a\n");
    await writeMobileArtifact(artifactB, "signed-android-artifact-b\n");
    await writeGooglePlayConfig(tmp, staging);
    await installGooglePlayTargets(tmp, [staging]);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, staging);
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: staging.label,
      deployment: staging,
    });
    const env = googlePlayFakeEnv(tmp);
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
    const rollbackRecord = await readGooglePlayDeployRecord(rollback.recordPath);
    assert.equal(rollbackRecord.operationKind, "rollback");
    assert.equal(rollbackRecord.parentRunId, runA.deployRunId);
    assert.equal(rollbackRecord.runnerIdentities.publisher, staging.publisher.type);
    assert.equal(rollbackRecord.releaseHealth?.status, "healthy");
    assert.equal(rollbackRecord.trackState?.track, "beta");
  });
});
