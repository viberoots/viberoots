#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { resolveDeploymentContextNode } from "../../deployments/deployment-contexts";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
} from "./deployment-contexts.scope.helpers";

function controlPlanes(overrides: Record<string, unknown> = {}) {
  return {
    prod: {
      serviceClient: {
        controlPlaneUrl: "https://control.prod.example",
        controlPlaneTokenRef: "secret://control/prod/service-token",
      },
      records: { backend: "service" },
    },
    staging: {
      serviceClient: {
        controlPlaneUrl: "https://control.staging.example",
        controlPlaneTokenRef: "runtime://deployment-control-plane/service-token",
      },
    },
    ...overrides,
  };
}

function context(controlPlane: string, projectName = "pleomino-pages") {
  return {
    controlPlane,
    cloudflare: {
      account: "web-platform",
      projectName,
    },
  };
}

test("deployment context attaches normalized selected control-plane metadata", async () => {
  await withProjectConfig(
    {
      controlPlanes: controlPlanes(),
      deploymentContexts: { "app-prod": context("prod") },
    },
    async () => {
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      ).deployments[0];
      assert.equal(deployment?.deploymentContext?.controlPlane?.name, "prod");
      assert.equal(
        deployment?.deploymentContext?.controlPlane?.serviceClient.controlPlaneUrl,
        "https://control.prod.example",
      );
      assert.equal(
        deployment?.deploymentContext?.controlPlane?.serviceClient.controlPlaneTokenRef,
        "secret://control/prod/service-token",
      );
      assert.equal(deployment?.deploymentContext?.controlPlane?.records.backend, "service");
      const errors: string[] = [];
      const resolved = resolveDeploymentContextNode({
        node: cloudflareDeployment({ deployment_context: "app-prod" }),
        config: {
          controlPlanes: controlPlanes(),
          deploymentContexts: { "app-prod": context("prod") },
        },
        errors,
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(resolved.control_plane, {
        name: "prod",
        service_client: {
          control_plane_url: "https://control.prod.example",
          control_plane_token_ref: "secret://control/prod/service-token",
        },
        records: { backend: "service" },
      });
    },
  );
});

test("two contexts resolve to different control-plane profiles", async () => {
  await withProjectConfig(
    {
      controlPlanes: controlPlanes(),
      deploymentContexts: {
        "app-prod": context("prod", "pleomino-prod-pages"),
        "app-staging": context("staging", "pleomino-staging-pages"),
      },
    },
    async () => {
      const { deployments, errors } = extractCloudflarePagesDeployments(
        cloudflareNodes([
          cloudflareDeployment({ deployment_context: "app-staging" }),
          cloudflareDeployment({
            name: "//projects/deployments/pleomino/prod:deploy",
            deployment_context: "app-prod",
          }),
        ]),
      );
      assert.deepEqual(errors, []);
      const byName = new Map(deployments.map((deployment) => [deployment.label, deployment]));
      assert.equal(
        byName.get("//projects/deployments/pleomino/staging:deploy")?.deploymentContext
          ?.controlPlane?.serviceClient.controlPlaneUrl,
        "https://control.staging.example",
      );
      assert.equal(
        byName.get("//projects/deployments/pleomino/prod:deploy")?.deploymentContext?.controlPlane
          ?.serviceClient.controlPlaneUrl,
        "https://control.prod.example",
      );
    },
  );
});

test("control-plane selector and profile validation fail closed", async () => {
  for (const [name, profile, expected] of [
    ["missing-client", {}, "serviceClient is required"],
    [
      "missing-url",
      { serviceClient: { controlPlaneTokenRef: "secret://token" } },
      "controlPlaneUrl is required",
    ],
    [
      "missing-token",
      { serviceClient: { controlPlaneUrl: "https://control.example" } },
      "controlPlaneTokenRef is required",
    ],
    [
      "bad-token-ref",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "config://token",
        },
      },
      "secret:// or runtime://",
    ],
    [
      "plaintext-token",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://token",
          token: "plain",
        },
      },
      "must not contain a plaintext token",
    ],
    [
      "plaintext-top-level-token",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://token",
        },
        token: "plain",
      },
      "must not contain a plaintext token",
    ],
    [
      "unsupported-key",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://token",
        },
        endpoint: "https://control.example",
      },
      "controlPlanes.endpoint is unsupported",
    ],
    [
      "bad-records-shape",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://token",
        },
        records: "service",
      },
      "records must be an object",
    ],
    [
      "bad-records",
      {
        serviceClient: {
          controlPlaneUrl: "https://control.example",
          controlPlaneTokenRef: "secret://token",
        },
        records: { backend: "local" },
      },
      "records.backend only supports service",
    ],
    [
      "bad-url",
      {
        serviceClient: {
          controlPlaneUrl: "http://control.example",
          controlPlaneTokenRef: "secret://token",
        },
      },
      "requires HTTPS",
    ],
  ] as const) {
    const config = {
      controlPlanes: controlPlanes({ [name]: profile }),
      deploymentContexts: { "app-prod": { controlPlane: name } },
    };
    await withProjectConfig(config, async () => {
      const errors = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      ).errors;
      assert.ok(
        errors.some((entry) => entry.includes(expected)),
        `${name}: ${expected}`,
      );
      const resolveErrors: string[] = [];
      const resolved = resolveDeploymentContextNode({
        node: cloudflareDeployment({ deployment_context: "app-prod" }),
        config,
        errors: resolveErrors,
      });
      assert.ok(
        resolveErrors.some((entry) => entry.includes(expected)),
        `${name}: ${expected}`,
      );
      assert.equal(resolved.control_plane, undefined, `${name}: no control_plane metadata`);
    });
  }
  await withProjectConfig(
    {
      controlPlanes: controlPlanes(),
      deploymentContexts: { "app-prod": { controlPlane: "missing" } },
    },
    async () => {
      const errors = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      ).errors;
      assert.ok(errors.some((entry) => entry.includes('controlPlane "missing"')));
    },
  );
});
