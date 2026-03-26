#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyNixosSharedHostScopedDeployments,
  emptyNixosSharedHostPlatformState,
} from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host platform state scoped apply creates entries from an empty state", () => {
  const next = applyNixosSharedHostScopedDeployments(emptyNixosSharedHostPlatformState(), [
    nixosSharedHostDeploymentFixture(),
  ]);
  assert.equal(next.deployments.length, 1);
  assert.equal(next.deployments[0]?.deploymentId, "pleomino-dev");
  assert.equal(next.deployments[0]?.providerTarget.hostname, "pleomino.apps.kilty.io");
});
