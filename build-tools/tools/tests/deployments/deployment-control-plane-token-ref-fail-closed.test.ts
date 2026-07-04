#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runProtectedCloudflarePagesDeployFrontDoor } from "../../deployments/cloudflare-pages-protected-front-door";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { resolveProtectedSharedServiceClient } from "../../deployments/deployment-service-client-selection";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const STAGING_REF = "secret://control-plane/sample-webapp/staging/service-token";

test("protected/shared secret token refs require explicit backend selection before mutation", async () => {
  const control = await startControlPlaneRecorder();
  try {
    await assert.rejects(
      () => runFrontDoor(deploymentWithoutSecretBackend(STAGING_REF, control.url)),
      /requires an explicit deployment secret backend/,
    );
    assert.deepEqual(control.paths, []);
  } finally {
    await control.close();
  }
});

test("protected/shared secret token refs require selected deployment context before mutation", async () => {
  const control = await startControlPlaneRecorder();
  try {
    await assert.rejects(
      () => runFrontDoor(deploymentWithoutSelectedContext(STAGING_REF, control.url, control.url)),
      /requires a selected deployment context/,
    );
    assert.deepEqual(control.paths, []);
  } finally {
    await control.close();
  }
});

test("invalid selected backend config fails before provider mutation", async () => {
  const control = await startControlPlaneRecorder();
  try {
    await assert.rejects(
      () =>
        runFrontDoor({
          ...deployment(STAGING_REF, control.url, control.url),
          infisicalRuntime: undefined,
        }),
      /requires a selected real DeploymentSecretContext; rejected missing secretContext/,
    );
    assert.deepEqual(control.paths, []);
  } finally {
    await control.close();
  }
});

test("unresolved selected secret token ref fails before provider mutation", async () => {
  const control = await startControlPlaneRecorder();
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [],
  );
  const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
  try {
    await assert.rejects(
      () => runFrontDoor(deployment(STAGING_REF, server.siteUrl, control.url)),
      /required secret contract secret:\/\/control-plane\/sample-webapp\/staging\/service-token is missing/,
    );
    assert.deepEqual(control.paths, []);
  } finally {
    restore();
    await server.close();
    await control.close();
  }
});

test("fixture backend success alone does not satisfy selected control-plane token ref", async () => {
  await withSecretFixture(
    {
      "secret://deployments/sample-webapp/cloudflare_api_token": {
        value: "provider-fixture-token",
      },
    },
    async () => {
      await assert.rejects(
        () =>
          resolveProtectedSharedServiceClient({
            deployment: deployment(STAGING_REF, "http://127.0.0.1"),
            context: "cloudflare-pages shared_nonprod mutation",
            env: {},
          }),
        /requires a selected real DeploymentSecretContext; rejected missing secretContext/,
      );
    },
  );
});

function deployment(
  tokenRef: string,
  siteUrl: string,
  controlPlaneUrl = "https://control-plane.example",
) {
  const base = cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-staging",
    controlPlane: {
      name: "sample-webapp-staging",
      serviceClient: {
        controlPlaneUrl,
        controlPlaneTokenRef: tokenRef,
      },
      records: { backend: "service" },
    },
    deploymentContext: { name: "sample-webapp-staging" },
  });
  return {
    ...base,
    secretBackend: "infisical" as const,
    infisicalRuntime: {
      siteUrl,
      projectId: "proj_123",
      environment: "prod",
      secretPath: "/",
    },
  };
}

function deploymentWithoutSecretBackend(tokenRef: string, siteUrl: string) {
  const selected = deployment(tokenRef, siteUrl);
  const { secretBackend: _secretBackend, infisicalRuntime: _infisicalRuntime, ...rest } = selected;
  return rest as CloudflarePagesDeployment;
}

function deploymentWithoutSelectedContext(
  tokenRef: string,
  siteUrl: string,
  controlPlaneUrl: string,
) {
  const selected = deployment(tokenRef, siteUrl, controlPlaneUrl);
  const { deploymentContext: _deploymentContext, ...rest } = selected;
  return rest as CloudflarePagesDeployment;
}

async function runFrontDoor(deployment: CloudflarePagesDeployment) {
  return await runProtectedCloudflarePagesDeployFrontDoor({
    workspaceRoot: process.cwd(),
    deployment,
    publishOnly: true,
    preview: false,
    previewCleanup: false,
    rollback: false,
    retireTarget: false,
    migrateTarget: false,
    targetExceptionRef: "",
    sourceRunId: "",
    cleanupReason: "manual_cleanup",
    controlPlaneUrl: "",
    hasFlag: () => false,
  });
}

async function withSecretFixture(
  contracts: Record<string, { value: string }>,
  run: () => Promise<void>,
) {
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-token-ref-"));
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

async function startControlPlaneRecorder() {
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(String(request.url || ""));
    response.writeHead(200, {
      connection: "close",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        final: { lifecycleState: "finished", finalOutcome: "succeeded" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind control plane");
  return {
    paths,
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
