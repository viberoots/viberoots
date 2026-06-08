#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAppStoreConnectDeployFrontDoor } from "../../deployments/app-store-connect-front-door";
import { runCloudflareContainersDeployFrontDoor } from "../../deployments/cloudflare-containers-front-door";
import { runCloudflareDeployFrontDoor } from "../../deployments/cloudflare-pages-front-door";
import { runProviderDeployFrontDoor } from "../../deployments/deploy-cli-provider-dispatch";
import { runGooglePlayDeployFrontDoor } from "../../deployments/google-play-front-door";
import { runKubernetesDeployFrontDoor } from "../../deployments/kubernetes-front-door";
import { runS3StaticDeployFrontDoor } from "../../deployments/s3-static-front-door";
import { runVercelDeployFrontDoor } from "../../deployments/vercel-front-door";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { googlePlayDeploymentFixture } from "./google-play.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { withEnv, withProjectConfig } from "./deployment-contexts.scope.helpers";
import {
  TOKEN_REF,
  cloudflareContainersDeployment,
  flags,
  runtimeHostConfig,
  withFetchCapture,
} from "./deployment-service-client-provider-front-doors.helpers";

test("dispatch forwards --remote profiles through protected/shared provider front doors", async () => {
  await withRemoteProfile(async () => {
    for (const run of dispatchRuns()) {
      const calls = await withFetchCapture(run);
      assertRemoteProfileSubmission(calls);
    }
  });
});

test("direct protected front doors forward --remote to service-client selection", async () => {
  await withRemoteProfile(async () => {
    const calls = [];
    for (const run of directFrontDoorRuns()) calls.push(...(await withFetchCapture(run)));
    assert.equal(calls.length, 7);
    for (const call of calls) assertRemoteProfileSubmission([call]);
  });
});

function dispatchRuns(): Array<() => Promise<void>> {
  return [
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: s3StaticDeploymentFixture(),
        flags: flags({ remote: "mini", provisionOnly: true }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: cloudflarePagesDeploymentFixture(),
        flags: flags({ remote: "mini", publishOnly: true, sourceRunId: "admitted-run" }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: cloudflareContainersDeployment(),
        flags: flags({ remote: "mini", artifactDirFlag: "/tmp/cloudflare-container" }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: appStoreConnectDeploymentFixture(),
        flags: flags({ remote: "mini", artifactDirFlag: "/tmp/app-store" }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: googlePlayDeploymentFixture(),
        flags: flags({ remote: "mini", artifactDirFlag: "/tmp/google-play" }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: kubernetesDeploymentFixture(),
        flags: flags({ remote: "mini", provisionOnly: true }),
        hasFlag: () => false,
      }),
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: vercelDeploymentFixture(),
        flags: flags({ remote: "mini", publishOnly: true, sourceRunId: "admitted-run" }),
        hasFlag: () => false,
      }),
  ];
}

function directFrontDoorRuns(): Array<() => Promise<void>> {
  return [
    () =>
      runS3StaticDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: s3StaticDeploymentFixture(),
        requireServiceForProtectedShared: false,
        publishOnly: false,
        provisionOnly: true,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
    () =>
      runCloudflareDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: cloudflarePagesDeploymentFixture(),
        requireServiceForProtectedShared: false,
        publishOnly: true,
        preview: false,
        previewCleanup: false,
        rollback: false,
        retireTarget: false,
        migrateTarget: false,
        targetExceptionRef: "",
        sourceRunId: "admitted-run",
        artifactDirFlag: "",
        cleanupReason: "manual_cleanup",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        provisionOnly: false,
      }),
    () =>
      runCloudflareContainersDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: cloudflareContainersDeployment(),
        requireServiceForProtectedShared: false,
        artifactDirFlag: "/tmp/cloudflare-container",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
    () =>
      runAppStoreConnectDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: appStoreConnectDeploymentFixture(),
        publishOnly: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "/tmp/app-store",
        requireServiceForProtectedShared: false,
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
    () =>
      runGooglePlayDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: googlePlayDeploymentFixture(),
        publishOnly: false,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "/tmp/google-play",
        requireServiceForProtectedShared: false,
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
    () =>
      runKubernetesDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: kubernetesDeploymentFixture(),
        requireServiceForProtectedShared: false,
        publishOnly: false,
        provisionOnly: true,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
    () =>
      runVercelDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: vercelDeploymentFixture(),
        requireServiceForProtectedShared: false,
        publishOnly: true,
        preview: false,
        previewCleanup: false,
        rollback: false,
        sourceRunId: "admitted-run",
        artifactDirFlag: "",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        hasFlag: () => false,
      }),
  ];
}

function withRemoteProfile(run: () => Promise<void>) {
  return withProjectConfig(remoteControlPlaneConfig(), () =>
    withEnv("DEPLOY_CONTROL_PLANE_TOKEN", "remote-token", run),
  );
}

function remoteControlPlaneConfig() {
  return {
    ...runtimeHostConfig(),
    controlPlanes: {
      mini: {
        serviceClient: {
          controlPlaneUrl: "https://remote.example",
          controlPlaneTokenRef: TOKEN_REF,
        },
      },
    },
  };
}

function assertRemoteProfileSubmission(calls: Awaited<ReturnType<typeof withFetchCapture>>) {
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://remote.example/api/v1/submissions");
  assert.equal(calls[0]?.authorization, "Bearer remote-token");
  assert.equal(calls[0]?.body.controlPlaneSelection.source, "explicit");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneUrl, "https://remote.example");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneName, "mini");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneTokenRef, TOKEN_REF);
}
