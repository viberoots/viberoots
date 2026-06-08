#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
} from "./deployment-contexts.scope.helpers";

function errorsForContext() {
  return extractCloudflarePagesDeployments(
    cloudflareNodes([cloudflareDeployment({ deployment_context: "app-prod" })]),
  ).errors.join("\n");
}

test("control-plane missing-value diagnostics classify selector and URL as shared config", async () => {
  await withProjectConfig(
    {
      controlPlanes: {},
      deploymentContexts: { "app-prod": { controlPlane: "missing" } },
    },
    async () => {
      assert.match(errorsForContext(), /profile names are shared config/);
    },
  );
  await withProjectConfig(
    {
      controlPlanes: {
        mini: { serviceClient: { controlPlaneTokenRef: "secret://control/token" } },
      },
      deploymentContexts: { "app-prod": { controlPlane: "mini" } },
    },
    async () => {
      assert.match(errorsForContext(), /control-plane URLs are shared config/);
    },
  );
});

test("control-plane missing-value diagnostics classify service-token refs as credentials", async () => {
  await withProjectConfig(
    {
      controlPlanes: { mini: { serviceClient: { controlPlaneUrl: "https://control.example" } } },
      deploymentContexts: { "app-prod": { controlPlane: "mini" } },
    },
    async () => {
      assert.match(
        errorsForContext(),
        /service-token refs are secret:\/\/ or runtime:\/\/ credentials/,
      );
    },
  );
  await withProjectConfig(
    {
      controlPlanes: {
        mini: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "config://control/token",
          },
        },
      },
      deploymentContexts: { "app-prod": { controlPlane: "mini" } },
    },
    async () => {
      const errors = errorsForContext();
      assert.match(errors, /secret:\/\/ or runtime:\/\/ credential ref/);
      assert.match(errors, /not config:\/\//);
    },
  );
});
