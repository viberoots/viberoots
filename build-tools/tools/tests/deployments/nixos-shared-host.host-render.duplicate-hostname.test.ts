#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderNixosSharedHostConfig } from "../../deployments/nixos-shared-host";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("nixos-shared-host rendering fails closed on duplicate hostnames", () => {
  const state = createNixosSharedHostPlatformState([
    nixosSharedHostDeploymentFixture(),
    nixosSharedHostDeploymentFixture({
      deploymentId: "other-dev",
      label: "//projects/deployments/other-dev:deploy",
      component: { kind: "static-webapp", target: "//projects/apps/other:app" },
      runtime: { appName: "other", containerPort: 4000 },
      providerTarget: {
        host: "nixos-shared-host",
        appName: "other",
        targetGroup: "default",
        hostname: "demoapp.apps.kilty.io",
        containerName: "other",
        sharedDevTargetIdentity: "nixos-shared-host:default:other",
      },
    }),
  ]);
  assert.throws(
    () => renderNixosSharedHostConfig(state),
    /duplicate hostname "demoapp\.apps\.kilty\.io"/,
  );
});
