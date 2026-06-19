#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";

async function startHostedStatusServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify(
          {
            schemaVersion: "deployment-control-plane-status@1",
            submissionId: "submission-hosted-ux",
            submittedAt: "2026-04-16T12:00:00Z",
            deploymentId: "demoapp-dev",
            deploymentLabel,
            operationKind: "deploy",
            providerTargetIdentity: "nixos-shared-host:default:demoapp",
            lockScope: "nixos-shared-host:default:demoapp",
            lifecycleState: "pending_approval",
            terminationReason: null,
            deployRunId: "deploy-run-hosted-ux",
            dedupe: { mode: "created", requestFingerprint: "sha256:status" },
            artifact: {
              phase: "admitted",
              producerKind: "client_upload",
              artifactIdentity: "static-webapp:abc123",
              artifactDigest: "abc123",
            },
            execution: {
              currentStep: "smoke",
              stepStartedAt: "2026-04-16T12:03:00.000Z",
              timeoutMs: 600000,
            },
            approval: {
              state: "pending",
              approvalNames: ["human/dev"],
              payloadFingerprint: "sha256:payload",
              targetIdentity: "nixos-shared-host:default:demoapp",
            },
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not found" }) + "\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind mock server");
  return {
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("deploy --status --text summarizes hosted run phase, approval, and artifact identity", async () => {
  await runInTemp("deploy-hosted-status-text", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const mock = await startHostedStatusServer();
    try {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${deploymentLabel} --status --text --deploy-run-id deploy-run-hosted-ux --control-plane-url ${mock.url}`;
      const text = String(result.stdout);
      assert.match(text, /status: pending approval/);
      assert.match(text, /deployRunId: deploy-run-hosted-ux/);
      assert.match(text, /artifact: admitted \| client_upload \| static-webapp:abc123/);
      assert.match(text, /digest abc123/);
      assert.match(text, /execution: smoke \| started 2026-04-16T12:03:00.000Z/);
      assert.match(text, /timeout 600000ms/);
      assert.match(text, /approval: deploy --approve --deploy-run-id deploy-run-hosted-ux/);
    } finally {
      await mock.close();
    }
  });
});
