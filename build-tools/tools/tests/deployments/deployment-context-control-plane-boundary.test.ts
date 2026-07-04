#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withEnv,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";

function baseConfig() {
  return {
    controlPlanes: {
      prod: {
        serviceClient: {
          controlPlaneUrl: "https://control.prod.example",
          controlPlaneTokenRef: "secret://control/prod/service-token",
        },
      },
      local: {
        serviceClient: { controlPlaneUrl: "https://local.example" },
      },
    },
  };
}

function context(controlPlane: string) {
  return {
    controlPlane,
    cloudflare: {
      account: "web-platform",
      projectName: "sample-webapp-pages",
    },
  };
}

test("local config accepts runtime token refs and rejects plaintext token fields", async () => {
  await withProjectConfig(
    { ...baseConfig(), deploymentContexts: { "app-prod": context("local") } },
    async () => {
      await writeJson("projects/config/local.json", {
        controlPlanes: { local: { serviceClient: { controlPlaneToken: "plain" } } },
      });
      const errors = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      ).errors;
      assert.ok(errors.some((entry) => entry.includes("controlPlaneToken must not contain")));
      await writeJson("projects/config/local.json", {
        controlPlanes: {
          local: { serviceClient: { controlPlaneTokenRef: "runtime://service/token" } },
        },
      });
      const ok = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      );
      assert.deepEqual(ok.errors, []);
    },
  );
});

test("local control-plane profile overrides are redacted in context diagnostics", async () => {
  await withProjectConfig(
    { ...baseConfig(), deploymentContexts: { "app-prod": context("prod") } },
    async () => {
      await writeJson("projects/config/local.json", {
        controlPlanes: {
          prod: { serviceClient: { controlPlaneTokenRef: "secret://local/control/token" } },
        },
      });
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      ).deployments[0];
      assert.ok(
        deployment?.deploymentContext?.localOverrides?.some(
          (entry) =>
            entry.path === "controlPlanes.prod.serviceClient.controlPlaneTokenRef" &&
            entry.localValue === "<redacted>",
        ),
      );
    },
  );
});

test("malformed local control-plane overrides remain visible to diagnostics and guard", async () => {
  await withProjectConfig(
    { ...baseConfig(), deploymentContexts: { "app-prod": context("prod") } },
    async () => {
      await writeJson("projects/config/local.json", {
        controlPlanes: {
          prod: { serviceClient: { controlPlaneTokenRef: "config://local/control/token" } },
        },
      });
      const result = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
      );
      const deployment = result.deployments[0];
      assert.ok(result.errors.some((entry) => entry.includes("secret:// or runtime://")));
      assert.equal(deployment?.deploymentContext?.controlPlane, undefined);
      assert.ok(
        deployment?.deploymentContext?.localOverrides?.some(
          (entry) =>
            entry.path === "controlPlanes.prod.serviceClient.controlPlaneTokenRef" &&
            entry.localValue === "<redacted>",
        ),
      );
      await withEnv("VBR_DISALLOW_LOCAL_OVERRIDES", "1", async () => {
        const { errors } = extractCloudflarePagesDeployments(
          cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
        );
        assert.ok(
          errors.some(
            (entry) =>
              entry.includes("local project config overrides are disabled") &&
              entry.includes("controlPlanes.prod.serviceClient.controlPlaneTokenRef"),
          ),
        );
      });
    },
  );
});

test("app packages cannot declare control-plane selection directly", () => {
  const errors = extractCloudflarePagesDeployments(
    cloudflareNodes([
      { name: "//projects/apps/sample-webapp:app", labels: ["kind:app"], controlPlane: "prod" },
    ]),
  ).errors;
  assert.ok(errors.some((entry) => entry.includes("apps cannot declare")));
});
