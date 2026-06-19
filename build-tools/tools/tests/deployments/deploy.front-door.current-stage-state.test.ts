#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";

async function startStageStateServer() {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    const state = {
      schemaVersion: "deployment-current-stage-state@1",
      deploymentId: "demo-dev",
      deploymentLabel,
      environmentStage: "dev",
      providerTargetIdentity: "nixos-shared-host:default:demo",
      currentRunId: "deploy-current",
      operationKind: "deploy",
      sourceRevision: "abc123",
      artifactIdentity: "static-webapp:abc123",
      artifactReuseMode: "same_artifact",
      finalOutcome: "succeeded",
      updatedAt: "2026-05-12T12:00:00.000Z",
      approvalContext: { requiredApprovals: [] },
    };
    const isCurrentList =
      url.pathname.endsWith("current-stage-state") &&
      (!url.searchParams.get("deploymentId") || !url.searchParams.get("environmentStage"));
    response.end(
      JSON.stringify(url.pathname.endsWith("stage-history") || isCurrentList ? [state] : state),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind mock server");
  return {
    requests,
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("deploy current-stage helpers read and render service-backed stage state", async () => {
  await runInTemp("deploy-current-stage-state-helper", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const mock = await startStageStateServer();
    try {
      const current = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --current-stage-state --text --control-plane-url ${mock.url}`;
      assert.match(String(current.stdout), /currentRunId: deploy-current/);
      assert.match(String(current.stdout), /sourceRevision: abc123/);
      const history = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --stage-history --control-plane-url ${mock.url}`;
      assert.equal(JSON.parse(String(history.stdout))[0].currentRunId, "deploy-current");
      const byDeployment = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --current-stage-state --by-deployment --text --control-plane-url ${mock.url}`;
      assert.match(String(byDeployment.stdout), /currentRunId: deploy-current/);
      const byStage = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --current-stage-state --by-stage --text --control-plane-url ${mock.url}`;
      assert.match(String(byStage.stdout), /currentRunId: deploy-current/);
      assert.deepEqual(mock.requests, [
        "GET /api/v1/current-stage-state?deploymentId=demo-dev&environmentStage=dev",
        "GET /api/v1/stage-history?deploymentId=demo-dev&environmentStage=dev",
        "GET /api/v1/current-stage-state?deploymentId=demo-dev",
        "GET /api/v1/current-stage-state?environmentStage=dev",
      ]);
    } finally {
      await mock.close();
    }
  });
});
