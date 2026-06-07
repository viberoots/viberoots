#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAppStoreConnectDeployFrontDoor } from "../../deployments/app-store-connect-front-door";
import { runCloudflareContainersDeployFrontDoor } from "../../deployments/cloudflare-containers-front-door";
import { runProviderDeployFrontDoor } from "../../deployments/deploy-cli-provider-dispatch";
import { runGooglePlayDeployFrontDoor } from "../../deployments/google-play-front-door";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture";
import { googlePlayDeploymentFixture } from "./google-play.fixture";
import { withEnv, withProjectConfig } from "./deployment-contexts.scope.helpers";
import {
  SELECTED_URL,
  cloudflareContainersDeployment,
  flags,
  runtimeHostConfig,
  withControlPlane,
  withFetchCapture,
} from "./deployment-service-client-provider-front-doors.helpers";

test("provider front doors reject direct records/database paths for context-selected service routing", async () => {
  for (const [provider, deployment, run] of [
    [
      "app-store-connect",
      withControlPlane(appStoreConnectDeploymentFixture()),
      runAppStoreConnectDeployFrontDoor,
    ],
    ["google-play", withControlPlane(googlePlayDeploymentFixture()), runGooglePlayDeployFrontDoor],
  ] as const) {
    for (const flag of ["--records-root", "--control-plane-database-url"]) {
      await assert.rejects(
        () =>
          run({
            workspaceRoot: process.cwd(),
            deployment: deployment as any,
            publishOnly: false,
            rollback: false,
            sourceRunId: "",
            artifactDirFlag: "/tmp/artifact",
            requireServiceForProtectedShared: false,
            controlPlaneUrl: "",
            allowControlPlaneOverride: false,
            hasFlag: (candidate) => candidate === flag.slice(2),
          }),
        new RegExp(`service-only ${provider} deploy does not support ${flag}`),
      );
    }
  }
  for (const flag of ["--records-root", "--control-plane-database-url"]) {
    await assert.rejects(
      () =>
        runCloudflareContainersDeployFrontDoor({
          workspaceRoot: process.cwd(),
          deployment: withControlPlane(cloudflareContainersDeployment()),
          requireServiceForProtectedShared: false,
          artifactDirFlag: "/tmp/artifact",
          controlPlaneUrl: "",
          allowControlPlaneOverride: false,
          hasFlag: (candidate) => candidate === flag.slice(2),
        }),
      new RegExp(`service-only cloudflare-containers deploy does not support ${flag}`),
    );
  }
});

test("context-selected provider front doors submit to selected control-plane service", async () => {
  await withProjectConfig(runtimeHostConfig(), async () => {
    await withEnv("DEPLOY_CONTROL_PLANE_TOKEN", "runtime-token", async () => {
      for (const [provider, deployment, run] of [
        [
          "app-store-connect",
          withControlPlane(appStoreConnectDeploymentFixture()),
          runAppStoreConnectDeployFrontDoor,
        ],
        [
          "google-play",
          withControlPlane(googlePlayDeploymentFixture()),
          runGooglePlayDeployFrontDoor,
        ],
      ] as const) {
        const calls = await withFetchCapture(async () => {
          await run({
            workspaceRoot: process.cwd(),
            deployment: deployment as any,
            publishOnly: false,
            rollback: false,
            sourceRunId: "",
            artifactDirFlag: `/tmp/${provider}-artifact`,
            requireServiceForProtectedShared: false,
            controlPlaneUrl: "",
            allowControlPlaneOverride: false,
            hasFlag: () => false,
          });
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, `${SELECTED_URL}/api/v1/submissions`);
        assert.equal(calls[0]?.authorization, "Bearer runtime-token");
        assert.equal(calls[0]?.body.deployment.provider, provider);
        assert.equal(calls[0]?.body.operationKind, "deploy");
        assert.equal(calls[0]?.body.controlPlaneSelection.source, "context");
        assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneUrl, SELECTED_URL);
        assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneName, "prod");
      }
      const calls = await withFetchCapture(async () => {
        await runCloudflareContainersDeployFrontDoor({
          workspaceRoot: process.cwd(),
          deployment: withControlPlane(cloudflareContainersDeployment()),
          requireServiceForProtectedShared: false,
          artifactDirFlag: "/tmp/cloudflare-containers-artifact",
          controlPlaneUrl: "",
          allowControlPlaneOverride: false,
          hasFlag: () => false,
        });
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, `${SELECTED_URL}/api/v1/submissions`);
      assert.equal(calls[0]?.authorization, "Bearer runtime-token");
      assert.equal(calls[0]?.body.deployment.provider, "cloudflare-containers");
      assert.equal(calls[0]?.body.operationKind, "deploy");
      assert.equal(calls[0]?.body.controlPlaneSelection.source, "context");
      assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneUrl, SELECTED_URL);
    });
  });
});

test("dispatch passes control-plane flags to provider service front doors", async () => {
  await assert.rejects(
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: withControlPlane(appStoreConnectDeploymentFixture()),
        flags: flags({ controlPlaneUrl: "https://other.example" }),
        hasFlag: () => false,
      }),
    /--control-plane-url https:\/\/other.example disagrees with deployment context controlPlane prod/,
  );
  await assert.rejects(
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: withControlPlane(googlePlayDeploymentFixture()),
        flags: flags({ controlPlaneUrl: "https://other.example" }),
        hasFlag: () => false,
      }),
    /--control-plane-url https:\/\/other.example disagrees with deployment context controlPlane prod/,
  );
  await assert.rejects(
    () =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: withControlPlane(cloudflareContainersDeployment()),
        flags: flags({ controlPlaneUrl: "https://other.example" }),
        hasFlag: () => false,
      }),
    /--control-plane-url https:\/\/other.example disagrees with deployment context controlPlane prod/,
  );
});
