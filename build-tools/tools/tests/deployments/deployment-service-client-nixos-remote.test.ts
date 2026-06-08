#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runProviderDeployFrontDoor } from "../../deployments/deploy-cli-provider-dispatch";
import { runNixosSharedHostDeployFrontDoor } from "../../deployments/deploy-provider-front-door";
import { withEnv, withProjectConfig } from "./deployment-contexts.scope.helpers";
import {
  TOKEN_REF,
  flags,
  runtimeHostConfig,
  withFetchCapture,
} from "./deployment-service-client-provider-front-doors.helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("dispatch forwards --remote through nixos shared-host protected front door", async () => {
  await withRemoteProfile(async () => {
    const calls = await withFetchCapture(() =>
      runProviderDeployFrontDoor({
        workspaceRoot: process.cwd(),
        publicFrontDoor: false,
        deployment: nixosSharedHostDeploymentFixture(),
        flags: flags({ remote: "mini", provisionOnly: true }),
        hasFlag: () => false,
      }),
    );
    assertRemoteProfileSubmission(calls);
  });
});

test("direct nixos shared-host front door uses opts.remote", async () => {
  await withRemoteProfile(async () => {
    const calls = await withFetchCapture(() =>
      runNixosSharedHostDeployFrontDoor({
        workspaceRoot: process.cwd(),
        deployment: nixosSharedHostDeploymentFixture(),
        publishOnly: false,
        provisionOnly: true,
        rollback: false,
        sourceRunId: "",
        artifactDirFlag: "",
        controlPlaneUrl: "",
        remote: "mini",
        allowControlPlaneOverride: false,
        vaultRuntimeInputs: {},
      }),
    );
    assertRemoteProfileSubmission(calls);
  });
});

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
  assert.equal(calls[0]?.body.deployment.provider, "nixos-shared-host");
  assert.equal(calls[0]?.body.operationKind, "provision_only");
  assert.equal(calls[0]?.body.controlPlaneSelection.source, "explicit");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneUrl, "https://remote.example");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneName, "mini");
  assert.equal(calls[0]?.body.controlPlaneSelection.controlPlaneTokenRef, TOKEN_REF);
}
