#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveServiceClientFromFlags } from "../../deployments/nixos-shared-host-service-client-config.ts";

test("nixos shared-host service client resolves the reviewed mini remote alias", () => {
  assert.equal(
    resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: {},
    }).controlPlaneUrl,
    "http://mini:7780",
  );
  assert.equal(
    resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: { BNX_DEPLOY_MINI_CONTROL_PLANE_URL: "http://127.0.0.1:7780" },
    }).controlPlaneUrl,
    "http://127.0.0.1:7780",
  );
});
