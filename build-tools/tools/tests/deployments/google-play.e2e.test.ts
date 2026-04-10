#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readGooglePlayDeployRecord } from "../../deployments/google-play-records.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { googlePlayDeploymentFixture } from "./google-play.fixture.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
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
  deployment: ReturnType<typeof googlePlayDeploymentFixture>,
) {
  const packageDir = path.join(workspaceRoot, "projects", "deployments", deployment.deploymentId);
  await fsp.mkdir(packageDir, { recursive: true });
  await fsp.writeFile(
    path.join(packageDir, "google-play.jsonc"),
    JSON.stringify(
      {
        developer_account: deployment.providerTarget.developerAccount,
        app: deployment.providerTarget.app,
        package_name: deployment.providerTarget.packageName,
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

test("google-play deploy and promotion preserve release-health evidence", async () => {
  await runInTemp("google-play-promotion", async (tmp, $) => {
    const lanePolicy = nixosSharedHostLanePolicyFixture({
      stageBranches: {
        dev: "env/mobile/dev",
        staging: "env/mobile/staging",
        prod: "env/mobile/prod",
      },
    });
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
    await writeArtifact(artifactPath, "signed-android-artifact-v1\n");
    await writeConfig(tmp, dev);
    await writeConfig(tmp, staging);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson: devJson,
      deployment: dev,
    });
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson: stagingJson,
      deployment: staging,
    });
    const env = {
      ...process.env,
      BNX_GOOGLE_PLAY_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
    };
    const devRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${devJson} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactPath} --records-root ${recordsRoot}`;
    const devSummary = JSON.parse(String(devRun.stdout));
    const promotionRun = await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --admission-evidence-json ${stagingEvidenceJson} --publish-only --source-run-id ${devSummary.deployRunId} --records-root ${recordsRoot}`;
    const promotionSummary = JSON.parse(String(promotionRun.stdout));
    const promotionRecord = await readGooglePlayDeployRecord(promotionSummary.recordPath);
    assert.equal(promotionRecord.operationKind, "promotion");
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
    const lanePolicy = nixosSharedHostLanePolicyFixture({
      stageBranches: {
        dev: "env/mobile/dev",
        staging: "env/mobile/staging",
        prod: "env/mobile/prod",
      },
    });
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
    await writeArtifact(artifactA, "signed-android-artifact-a\n");
    await writeArtifact(artifactB, "signed-android-artifact-b\n");
    await writeConfig(tmp, staging);
    await writeDeploymentJson(stagingJson, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    const stagingEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson: stagingJson,
      deployment: staging,
    });
    const env = {
      ...process.env,
      BNX_GOOGLE_PLAY_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
    };
    const runA = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --admission-evidence-json ${stagingEvidenceJson} --artifact-dir ${artifactA} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    await $({
      cwd: tmp,
      env,
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --admission-evidence-json ${stagingEvidenceJson} --artifact-dir ${artifactB} --records-root ${recordsRoot}`;
    const rollback = JSON.parse(
      String(
        (
          await $({
            cwd: tmp,
            env,
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${stagingJson} --admission-evidence-json ${stagingEvidenceJson} --publish-only --rollback --source-run-id ${runA.deployRunId} --records-root ${recordsRoot}`
        ).stdout,
      ),
    );
    const rollbackRecord = await readGooglePlayDeployRecord(rollback.recordPath);
    assert.equal(rollbackRecord.operationKind, "rollback");
    assert.equal(rollbackRecord.parentRunId, runA.deployRunId);
    assert.equal(rollbackRecord.releaseHealth?.status, "healthy");
    assert.equal(rollbackRecord.trackState?.track, "beta");
  });
});
