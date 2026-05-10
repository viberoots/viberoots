#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_FIXTURE_SERVICE_ENV,
  validateProtectedSharedServiceTransport,
} from "../../deployments/deployment-service-transport-policy";
import { resolveServiceClientFromFlags } from "../../deployments/nixos-shared-host-service-client-config";

test("nixos shared-host service client resolves the reviewed mini remote alias", () => {
  assert.equal(
    resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: {},
    }).controlPlaneUrl,
    "https://deploy.apps.kilty.io",
  );
  assert.equal(
    resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: {
        VBR_DEPLOY_MINI_CONTROL_PLANE_URL: "http://127.0.0.1:7780",
        [LOCAL_FIXTURE_SERVICE_ENV]: "1",
      },
    }).controlPlaneUrl,
    "http://127.0.0.1:7780",
  );
  assert.equal(
    resolveServiceClientFromFlags({
      controlPlaneUrl: "http://127.0.0.1:7780",
      context: "deploy",
      env: { [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
    }).controlPlaneUrl,
    "http://127.0.0.1:7780",
  );
  assert.throws(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "http://127.0.0.1:7780",
        context: "deploy",
        env: {},
      }),
    /LOCAL_FIXTURE_SERVICE/,
  );
});

test("nixos shared-host service client rejects insecure protected transport", () => {
  assert.throws(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "http://deploy.apps.kilty.io",
        context: "deploy",
        env: {},
      }),
    /requires HTTPS/,
  );
  assert.throws(
    () =>
      validateProtectedSharedServiceTransport({
        controlPlaneUrl: "http://127.0.0.1:7780",
        context: "deploy",
        env: {},
      }),
    /LOCAL_FIXTURE_SERVICE/,
  );
  assert.throws(
    () =>
      resolveServiceClientFromFlags({
        controlPlaneUrl: "https://deploy.apps.kilty.io",
        context: "deploy",
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      }),
    /TLS certificate validation/,
  );
});
