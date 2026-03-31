#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyNixosSharedHostScopedDeployments,
  createNixosSharedHostPlatformState,
} from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host platform state scoped apply does not delete out-of-scope deployments by omission", () => {
  const current = createNixosSharedHostPlatformState([
    nixosSharedHostDeploymentFixture(),
    nixosSharedHostDeploymentFixture({
      deploymentId: "other-dev",
      label: "//projects/deployments/other-dev:deploy",
      component: { kind: "static-webapp", target: "//projects/apps/other:app" },
      runtime: { appName: "other", containerPort: 4000 },
    }),
  ]);
  const next = applyNixosSharedHostScopedDeployments(current, [
    nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 4173 },
    }),
  ]);
  assert.deepEqual(
    next.deployments.map((deployment) => deployment.deploymentId),
    ["demoapp-dev", "other-dev"],
  );
});
