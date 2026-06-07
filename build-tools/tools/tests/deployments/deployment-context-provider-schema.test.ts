#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
} from "./deployment-contexts.scope.helpers";

test("deployment context rejects unknown Cloudflare provider fields", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "typo-prod": {
          cloudflare: {
            account: "web-platform",
            projectName: "typo-prod-pages",
            accountID: "misspelled",
            zone: "misspelled",
          },
        },
      },
    },
    async () => {
      const errors = contextErrors("typo-prod");
      assert.ok(errors.some((entry) => entry.includes("cloudflare.accountID is unsupported")));
      assert.ok(errors.some((entry) => entry.includes("cloudflare.zone is unsupported")));
    },
  );
});

test("deployment context rejects unknown Infisical provider fields", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "typo-prod": {
          infisical: {
            projectId: "proj",
            environment: "prod",
            projectID: "misspelled",
            clientIdReference: "secret://bootstrap/client-id",
          },
        },
      },
    },
    async () => {
      const errors = contextErrors("typo-prod");
      assert.ok(errors.some((entry) => entry.includes("infisical.projectID is unsupported")));
      assert.ok(
        errors.some((entry) => entry.includes("infisical.clientIdReference is unsupported")),
      );
    },
  );
});

test("deployment context rejects invalid snake_case Infisical machine identity refs", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "unsafe-prod": {
          infisical: {
            projectId: "proj",
            environment: "prod",
            machine_identity_client_id_ref: "not-a-ref",
            machine_identity_client_secret_ref: "also-not-a-ref",
          },
        },
      },
    },
    async () => {
      const errors = contextErrors("unsafe-prod");
      assert.ok(
        errors.some((entry) =>
          entry.includes("infisical.machine_identity_client_id_ref must be a secret:// ref"),
        ),
      );
      assert.ok(
        errors.some((entry) =>
          entry.includes("infisical.machine_identity_client_secret_ref must be a secret:// ref"),
        ),
      );
    },
  );
});

test("deployment context still rejects plaintext secret-looking provider fields", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "unsafe-prod": {
          cloudflare: { account: "web-platform", apiToken: "plaintext-token" },
          infisical: { projectId: "proj", environment: "prod", clientSecret: "plaintext" },
        },
      },
    },
    async () => {
      const errors = contextErrors("unsafe-prod");
      assert.ok(errors.some((entry) => entry.includes("cloudflare.apiToken is unsupported")));
      assert.ok(errors.some((entry) => entry.includes("cloudflare.apiToken must not contain")));
      assert.ok(errors.some((entry) => entry.includes("infisical.clientSecret is unsupported")));
      assert.ok(errors.some((entry) => entry.includes("infisical.clientSecret must not contain")));
    },
  );
});

function contextErrors(selector: string) {
  return extractCloudflarePagesDeployments(
    cloudflareNodes([cloudflareDeployment({ deployment_context: selector })]),
  ).errors;
}
