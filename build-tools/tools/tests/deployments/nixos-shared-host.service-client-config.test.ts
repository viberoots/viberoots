#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_FIXTURE_SERVICE_ENV,
  validateProtectedSharedServiceTransport,
} from "../../deployments/deployment-service-transport-policy";
import {
  resolveServiceClientFromFlags,
  resolveServiceClientFromManifest,
} from "../../deployments/nixos-shared-host-service-client-config";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";

test("nixos shared-host service client resolves --remote through control-plane profiles", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        mini: {
          serviceClient: {
            controlPlaneUrl: "https://deploy.apps.kilty.io",
            controlPlaneTokenRef: "secret://control-plane/mini/service-token",
          },
          records: { backend: "service" },
        },
      },
    },
    async () => {
      assert.equal(
        resolveServiceClientFromFlags({
          remote: "mini",
          context: "deploy",
          env: {},
        }).controlPlaneUrl,
        "https://deploy.apps.kilty.io",
      );
    },
  );
});

test("nixos shared-host service client rejects --remote without a matching profile", () => {
  assert.throws(
    () =>
      resolveServiceClientFromFlags({
        remote: "mini",
        context: "deploy",
        env: {},
      }),
    /controlPlanes\.mini profile/,
  );
});

test("nixos shared-host service client validates explicit control-plane URLs", () => {
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

test("nixos shared-host service client uses ambient URL for commands without context", () => {
  assert.equal(
    resolveServiceClientFromFlags({
      context: "deploy status",
      env: { VBR_DEPLOY_CONTROL_PLANE_URL: " https://deploy.apps.kilty.io " },
    }).controlPlaneUrl,
    "https://deploy.apps.kilty.io",
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

test("nixos shared-host service profile requires its configured token env", () => {
  const manifest = {
    schemaVersion: "nixos-shared-host-client@1",
    tool: "nixos-shared-host-install",
    toolFingerprint: "test",
    profileName: "mini",
    destination: "mini",
    remoteRepoPath: "/srv/viberoots",
    remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
    remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
    remoteRecordsRoot: "/var/lib/deployment-host/records",
    sshMode: "ssh",
    serviceClient: {
      controlPlaneUrl: "https://deploy.apps.kilty.io",
      controlPlaneTokenEnv: "VBR_DEPLOY_CONTROL_PLANE_TOKEN",
    },
    localManagedPaths: [],
  } as const;
  assert.throws(
    () => resolveServiceClientFromManifest(manifest, {}),
    /requires VBR_DEPLOY_CONTROL_PLANE_TOKEN to be set/,
  );
  assert.equal(
    resolveServiceClientFromManifest(manifest, {
      VBR_DEPLOY_CONTROL_PLANE_TOKEN: " service-token ",
    }).controlPlaneToken,
    "service-token",
  );
});
