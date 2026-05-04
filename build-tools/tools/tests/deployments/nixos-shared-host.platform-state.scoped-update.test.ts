#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyNixosSharedHostScopedDeployments,
  createNixosSharedHostPlatformState,
} from "../../deployments/nixos-shared-host-platform";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("nixos-shared-host platform state scoped apply updates an existing deployment in place", () => {
  const current = createNixosSharedHostPlatformState([nixosSharedHostDeploymentFixture()]);
  const next = applyNixosSharedHostScopedDeployments(current, [
    nixosSharedHostDeploymentFixture({
      runtime: {
        appName: "demoapp",
        containerPort: 4173,
        healthPath: "/readyz",
      },
    }),
  ]);
  assert.equal(next.deployments.length, 1);
  assert.equal(next.deployments[0]?.runtime.containerPort, 4173);
  assert.equal(next.deployments[0]?.runtime.healthPath, "/readyz");
});
