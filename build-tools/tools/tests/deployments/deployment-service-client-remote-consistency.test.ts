#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
} from "../../deployments/deployment-service-client-selection";
import { resolveServiceClientFromFlags } from "../../deployments/nixos-shared-host-service-client-config";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";

const RUNTIME_REF = "runtime://github-actions/control-plane-token";

test("remote service-client config rejects explicit URL and token inputs", async () => {
  await withRemoteHostConfig(async () => {
    await assert.rejects(
      () =>
        resolveServiceClientFromFlags({
          remote: "mini",
          controlPlaneUrl: "https://other.example",
          context: "deploy",
          env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
        }),
      /--remote mini cannot be combined with --control-plane-url/,
    );
    await assert.rejects(
      () =>
        resolveServiceClientFromFlags({
          remote: "mini",
          controlPlaneToken: "explicit-token",
          context: "deploy",
          env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
        }),
      /--remote mini cannot be combined with --control-plane-token/,
    );
  });
});

test("remote service-client config ignores ambient URL and uses profile URL", async () => {
  await withRemoteHostConfig(async () => {
    const client = await resolveServiceClientFromFlags({
      remote: "mini",
      context: "deploy",
      env: {
        DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token",
        VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
      },
    });
    assert.equal(client.controlPlaneUrl, "https://remote.example");
    assert.equal(client.controlPlaneToken, "runtime-token");
    assert.equal(client.controlPlaneName, "mini");
    assert.equal(client.controlPlaneTokenRef, RUNTIME_REF);
    assert.equal(client.plan.controlPlaneUrl, "https://remote.example");
    assert.equal(client.plan.controlPlaneTokenEnv, undefined);
  });
});

test("protected/shared no-context resolver rejects --remote with explicit URL", async () => {
  const noContext = cloudflarePagesDeploymentFixture({ controlPlane: undefined });
  await withRemoteHostConfig(async () => {
    await assert.rejects(
      () =>
        resolveProtectedSharedServiceClient({
          deployment: noContext,
          remote: "mini",
          controlPlaneUrl: "https://other.example",
          context: "cloudflare-pages shared_nonprod mutation",
          env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
        }),
      /--remote mini cannot be combined with --control-plane-url/,
    );
  });
});

test("protected/shared no-context resolver keeps remote URL ahead of ambient URL", async () => {
  const noContext = cloudflarePagesDeploymentFixture({ controlPlane: undefined });
  await withRemoteHostConfig(async () => {
    const client = await resolveProtectedSharedServiceClient({
      deployment: noContext,
      remote: "mini",
      context: "cloudflare-pages shared_nonprod mutation",
      env: {
        DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token",
        VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
      },
    });
    assert.equal(client.controlPlaneUrl, "https://remote.example");
    assert.equal(client.controlPlaneToken, "runtime-token");
    assert.equal(client.selectedSource, "explicit");
    assert.deepEqual(serviceClientSelectionEvidence(client), {
      source: "explicit",
      controlPlaneUrl: "https://remote.example",
      controlPlaneName: "mini",
      controlPlaneTokenRef: RUNTIME_REF,
    });
  });
});

function withRemoteHostConfig(run: () => Promise<void>) {
  return withProjectConfig(
    {
      runtimeHosts: {
        "github-actions": {
          bindings: {
            "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" },
          },
        },
      },
      controlPlanes: {
        mini: {
          serviceClient: {
            controlPlaneUrl: "https://remote.example",
            controlPlaneTokenRef: RUNTIME_REF,
          },
        },
      },
    },
    run,
  );
}
