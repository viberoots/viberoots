#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import { resolveControlPlaneServiceToken } from "../../deployments/nixos-shared-host-control-plane-service";

test("control-plane service token falls back to VBR_DEPLOY_CONTROL_PLANE_TOKEN", () => {
  assert.equal(
    resolveControlPlaneServiceToken({
      tokenFlag: "",
      env: { VBR_DEPLOY_CONTROL_PLANE_TOKEN: " env-token \n" } as NodeJS.ProcessEnv,
    }),
    "env-token",
  );
  assert.equal(
    resolveControlPlaneServiceToken({
      tokenFlag: " flag-token ",
      env: { VBR_DEPLOY_CONTROL_PLANE_TOKEN: "env-token" } as NodeJS.ProcessEnv,
    }),
    "flag-token",
  );
  assert.equal(
    resolveControlPlaneServiceToken({ tokenFlag: "", env: {} as NodeJS.ProcessEnv }),
    undefined,
  );
  assert.equal(
    resolveControlPlaneServiceToken({
      tokenFlag: "",
      env: { BNX_DEPLOY_CONTROL_PLANE_TOKEN: "legacy-token" } as NodeJS.ProcessEnv,
    }),
    undefined,
  );
});

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
