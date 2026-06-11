#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveServiceClientForOperator } from "../../deployments/deploy-control-plane-operator-client";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { withEnv, withProjectConfig } from "./deployment-contexts.scope.helpers";

const RUNTIME_REF = "runtime://github-actions/control-plane-token";

test("operator resolver keeps selected token ref during URL override", async () => {
  await withRuntimeHostConfig(async () => {
    await withArgv(["--control-plane-url", "https://other.example"], async () => {
      await assert.rejects(
        () => resolveClient(),
        /disagrees with deployment context controlPlane prod/,
      );
    });
    await withArgv(
      ["--control-plane-url", "https://override.example", "--allow-control-plane-override"],
      async () => {
        const client = await resolveClient();
        assert.equal(client.controlPlaneUrl, "https://override.example");
        assert.equal(client.controlPlaneToken, "runtime-token");
        assert.equal(client.selectedSource, "explicit_override");
        assert.equal(client.controlPlaneTokenRef, RUNTIME_REF);
      },
    );
    await withArgv(
      [
        "--control-plane-url",
        "https://override.example",
        "--control-plane-token",
        "raw-token",
        "--allow-control-plane-override",
      ],
      async () => {
        await assert.rejects(
          () => resolveClient(),
          /--control-plane-token cannot override deployment context controlPlane prod token ref runtime:\/\/github-actions\/control-plane-token/,
        );
      },
    );
    await withArgv(["--profile", "mini"], async () => {
      await assert.rejects(
        () => resolveClient(),
        /cannot use --profile\/--profile-root when deployment context selects a controlPlane/,
      );
    });
  });
});

function resolveClient() {
  return resolveServiceClientForOperator({
    workspaceRoot: process.cwd(),
    deployment: deployment(),
    actionLabel: "deploy --status",
  });
}

function deployment() {
  const controlPlane = {
    name: "prod",
    serviceClient: {
      controlPlaneUrl: "https://control.prod.example",
      controlPlaneTokenRef: RUNTIME_REF,
    },
    records: { backend: "service" as const },
  };
  return cloudflarePagesDeploymentFixture({
    controlPlane,
    deploymentContext: { name: "prod", controlPlane },
  });
}

function withRuntimeHostConfig(run: () => Promise<void>) {
  return withProjectConfig(
    {
      runtimeHosts: {
        "github-actions": {
          bindings: { "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" } },
        },
      },
    },
    () => withEnv("DEPLOY_CONTROL_PLANE_TOKEN", "runtime-token", run),
  );
}

async function withArgv(args: string[], run: () => Promise<void>) {
  const oldArgv = process.argv;
  process.argv = ["node", "test", ...args];
  try {
    await run();
  } finally {
    process.argv = oldArgv;
  }
}
