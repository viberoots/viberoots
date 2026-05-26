#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import { loadControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";
import { startControlPlaneServiceFromRuntimeConfig } from "../../deployments/nixos-shared-host-control-plane-service";
import { writeRuntimeConfig } from "./control-plane-process-entrypoints.helpers";

test("control-plane service requires a reviewed token unless fixture mode is explicit", async () => {
  await runInTemp("nixos-control-plane-service-token-required", async (tmp) => {
    const env = {} as NodeJS.ProcessEnv;
    const paths = {
      statePath: `${tmp}/platform-state.json`,
      hostRoot: `${tmp}/host`,
      recordsRoot: `${tmp}/records`,
    };
    await assert.rejects(
      startNixosSharedHostControlPlaneServer({
        workspaceRoot: tmp,
        paths,
        backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
        env,
      }),
      /requires --token or VBR_DEPLOY_CONTROL_PLANE_TOKEN/,
    );
    const fixture = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      localFixture: true,
      env,
    });
    await fixture.close();
  });
});

test("control-plane service runtime config reads mounted token file", async () => {
  await runInTemp("nixos-control-plane-service-token-file", async (tmp) => {
    const fixture = await writeRuntimeConfig(tmp);
    const runtimeConfig = await loadControlPlaneRuntimeConfig({
      configPath: fixture.configPath,
      repoRoot: tmp,
    });
    const service = await startControlPlaneServiceFromRuntimeConfig({
      workspaceRoot: tmp,
      runtimeConfig,
    });
    assert.match(service.url, /^http:\/\/127\.0\.0\.1:/);
    await service.close();
  });
});
