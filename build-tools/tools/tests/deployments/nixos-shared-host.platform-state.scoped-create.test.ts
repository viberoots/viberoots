#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyNixosSharedHostScopedDeployments,
  emptyNixosSharedHostPlatformState,
} from "../../deployments/nixos-shared-host-platform";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("nixos-shared-host platform state scoped apply creates entries from an empty state", () => {
  const next = applyNixosSharedHostScopedDeployments(emptyNixosSharedHostPlatformState(), [
    nixosSharedHostDeploymentFixture(),
  ]);
  assert.equal(next.deployments.length, 1);
  assert.equal(next.deployments[0]?.deploymentId, "demoapp-dev");
  assert.equal(next.deployments[0]?.providerTarget.hostname, "demoapp.apps.kilty.io");
});
