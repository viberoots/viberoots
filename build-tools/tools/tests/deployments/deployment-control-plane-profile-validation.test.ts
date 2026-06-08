#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { resolveDeploymentContextNode } from "../../deployments/deployment-contexts";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import { resolveServiceClientFromFlags } from "../../deployments/nixos-shared-host-service-client-config";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";

function errorsFor(overrides: Record<string, unknown>) {
  return extractCloudflarePagesDeployments(
    cloudflareNodes([cloudflareDeployment(overrides)]),
  ).errors.join("\n");
}

test("unreferenced shared control-plane profiles are validated fail-closed", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        unused: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "config://control/plain",
          },
        },
      },
      deploymentContexts: { "app-prod": { controlPlane: "missing" } },
    },
    async () => {
      const errors = errorsFor({ deployment_context: "app-prod" });
      assert.match(errors, /controlPlanes\.unused\.serviceClient\.controlPlaneTokenRef/);
      assert.match(errors, /must be a secret:\/\/ or runtime:\/\/ credential ref/);
    },
  );
});

test("unreferenced local control-plane override profiles reject plaintext fields", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "app-prod": {
          controlPlane: "prod",
          cloudflare: { account: "web-platform", projectName: "app-prod" },
        },
      },
      controlPlanes: {
        prod: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "runtime://github-actions/control-plane-token",
          },
        },
      },
    },
    async () => {
      await writeJson("projects/config/local.json", {
        controlPlanes: {
          unusedLocal: {
            serviceClient: {
              controlPlaneUrl: "https://local-control.example",
              controlPlaneTokenRef: "runtime://github-actions/local-token",
            },
            bearerToken: "super-secret-local-token",
          },
        },
      });
      const errors = errorsFor({ deployment_context: "app-prod" });
      assert.match(errors, /controlPlanes\.unusedLocal\.bearerToken/);
      assert.doesNotMatch(errors, /super-secret-local-token/);
    },
  );
});

test("protected contexts without controlPlane fail before provider routing", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "app-prod": { cloudflare: { account: "web-platform", projectName: "app-prod" } },
      },
    },
    async () => {
      assert.match(
        errorsFor({ deployment_context: "app-prod" }),
        /protected\/shared deployment_context app-prod must select a valid controlPlane/,
      );
    },
  );
});

test("local-only contexts remain valid without controlPlane", async () => {
  const errors: string[] = [];
  resolveDeploymentContextNode({
    node: cloudflareDeployment({
      deployment_context: "app-local",
      protection_class: "local_only",
    }),
    config: {
      deploymentContexts: {
        "app-local": { cloudflare: { account: "local", projectName: "app-local" } },
      },
    },
    errors,
  });
  assert.deepEqual(errors, []);
});

test("remote profile secret refs reject fixture fallback without selected real context", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        mini: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "secret://control-plane/mini/service-token",
          },
        },
      },
    },
    async () => {
      await withSecretFixture(
        {
          "secret://control-plane/mini/service-token": { value: "fixture-token" },
        },
        async () => {
          await assert.rejects(
            () =>
              resolveServiceClientFromFlags({
                remote: "mini",
                context: "protected/shared remote profile",
                env: {},
              }),
            /requires a selected real DeploymentSecretContext; rejected missing secretContext/,
          );
        },
      );
    },
  );
});

test("remote profile rejects unreferenced malformed shared profiles", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        mini: runtimeProfile("https://control.example", "runtime://github-actions/mini-token"),
        unused: runtimeProfile("https://unused.example", "config://bad-token-ref"),
      },
    },
    async () => {
      await assert.rejects(
        () =>
          resolveServiceClientFromFlags({
            remote: "mini",
            context: "protected/shared remote profile",
            env: {},
          }),
        /controlPlanes\.unused\.serviceClient\.controlPlaneTokenRef/,
      );
    },
  );
});

test("remote profile rejects unreferenced malformed local override profiles", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        mini: runtimeProfile("https://control.example", "runtime://github-actions/mini-token"),
      },
    },
    async () => {
      await writeJson("projects/config/local.json", {
        controlPlanes: {
          unusedLocal: {
            ...runtimeProfile("https://unused-local.example", "runtime://github-actions/unused"),
            token: "plaintext-local-token",
          },
        },
      });
      await assert.rejects(
        () =>
          resolveServiceClientFromFlags({
            remote: "mini",
            context: "protected/shared remote profile",
            env: {},
          }),
        (error) => {
          assert(error instanceof Error);
          assert.match(error.message, /controlPlanes\.unusedLocal\.token/);
          assert.doesNotMatch(error.message, /plaintext-local-token/);
          return true;
        },
      );
    },
  );
});

async function withSecretFixture(
  contracts: Record<string, { value: string }>,
  run: () => Promise<void>,
) {
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-profile-validation-"));
  const fixturePath = path.join(tmp, "secrets.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({ schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA, contracts }),
  );
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previous;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function runtimeProfile(controlPlaneUrl: string, controlPlaneTokenRef: string) {
  return {
    serviceClient: {
      controlPlaneUrl,
      controlPlaneTokenRef,
    },
  };
}
