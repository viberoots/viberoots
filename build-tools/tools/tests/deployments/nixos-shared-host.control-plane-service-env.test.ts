#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveControlPlaneServiceToken } from "../../deployments/nixos-shared-host-control-plane-service.ts";

test("control-plane service token falls back to BNX_DEPLOY_CONTROL_PLANE_TOKEN", () => {
  assert.equal(
    resolveControlPlaneServiceToken({
      tokenFlag: "",
      env: { BNX_DEPLOY_CONTROL_PLANE_TOKEN: " env-token \n" } as NodeJS.ProcessEnv,
    }),
    "env-token",
  );
  assert.equal(
    resolveControlPlaneServiceToken({
      tokenFlag: " flag-token ",
      env: { BNX_DEPLOY_CONTROL_PLANE_TOKEN: "env-token" } as NodeJS.ProcessEnv,
    }),
    "flag-token",
  );
  assert.equal(
    resolveControlPlaneServiceToken({ tokenFlag: "", env: {} as NodeJS.ProcessEnv }),
    undefined,
  );
});
