#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderNixosSharedHostConfig } from "../../deployments/nixos-shared-host.ts";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host rendering derives static-app containers and nginx routes from platform state", () => {
  const rendered = renderNixosSharedHostConfig(
    createNixosSharedHostPlatformState([
      nixosSharedHostDeploymentFixture({
        runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
      }),
    ]),
  );
  assert.deepEqual(rendered.containers.demoapp, {
    containerName: "demoapp",
    targetGroup: "default",
    hostname: "demoapp.apps.kilty.io",
    backendIdentity: "demoapp:3000",
    backendAddress: "http://demoapp.nixos-shared-host.internal:3000",
    runtime: "static-app-host",
    containerPort: 3000,
    publishRoot: "/srv/static-app/current",
    releaseRoot: "/srv/static-app/releases",
    activeReleaseLink: "/srv/static-app/live",
    healthPath: "/healthz",
  });
  assert.deepEqual(rendered.nginxVirtualHosts["demoapp.apps.kilty.io"], {
    hostname: "demoapp.apps.kilty.io",
    backendIdentity: "demoapp:3000",
    backendAddress: "http://demoapp.nixos-shared-host.internal:3000",
    targetGroup: "default",
    healthPath: "/healthz",
  });
});
