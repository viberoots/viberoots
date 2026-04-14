#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNixosSharedHostPlatformState,
  removeNixosSharedHostPlatformDeployment,
} from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host platform state explicit removal deletes only the named deployment", () => {
  const current = createNixosSharedHostPlatformState([
    nixosSharedHostDeploymentFixture(),
    nixosSharedHostDeploymentFixture({
      deploymentId: "other-dev",
      label: "//projects/deployments/other-dev:deploy",
      component: { kind: "static-webapp", target: "//projects/apps/other:app" },
      runtime: { appName: "other", containerPort: 4000 },
    }),
  ]);
  const next = removeNixosSharedHostPlatformDeployment(current, "demoapp-dev");
  assert.deepEqual(
    next.deployments.map((deployment) => deployment.deploymentId),
    ["other-dev"],
  );
});
