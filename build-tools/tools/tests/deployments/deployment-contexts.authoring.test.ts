#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
} from "./deployment-contexts.scope.helpers";

test("deployment authoring macros forward deployment_context across provider families", async () => {
  for (const file of [
    "build-tools/deployments/kubernetes_defs.bzl",
    "build-tools/deployments/nixos_shared_host_defs.bzl",
    "build-tools/deployments/opentofu_defs.bzl",
    "build-tools/deployments/s3_defs.bzl",
    "build-tools/deployments/vercel_defs.bzl",
  ]) {
    const text = await fs.readFile(file, "utf8");
    assert.match(text, /deployment_context = ""/);
    assert.match(text, /deployment_context = deployment_context/);
  }
});

test("deployment context rejects camelCase plaintext secret fields but allows Ref fields", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "safe-prod": {
          cloudflare: {
            account: "web-platform",
            projectName: "safe-prod",
            apiTokenRef: "secret://providers/cloudflare/api-token",
          },
          infisical: {
            clientSecretRef: "secret://bootstrap/infisical/client-secret",
            defaultPath: "/deployments/safe/prod",
          },
        },
        "unsafe-prod": {
          cloudflare: { account: "web-platform", apiToken: "plaintext-token" },
          infisical: { clientSecret: "plaintext-secret" },
        },
      },
    },
    async () => {
      const safe = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "safe-prod" })]),
      );
      assert.deepEqual(safe.errors, []);
      const errors = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "unsafe-prod" })]),
      ).errors;
      assert.ok(errors.some((entry) => entry.includes("cloudflare.apiToken")));
      assert.ok(errors.some((entry) => entry.includes("infisical.clientSecret")));
      assert.ok(errors.every((entry) => !entry.includes("clientSecretRef")));
    },
  );
});
