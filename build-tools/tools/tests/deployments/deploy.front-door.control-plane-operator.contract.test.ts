#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

const deploymentLabel = "//sandbox/deployments/demo-dev:deploy";

type MockControlPlaneConfig = {
  onStatus?: (url: URL) => unknown;
  onRecord?: (url: URL) => unknown;
  onRunAction?: (body: any) => unknown;
};

async function readJsonBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startMockControlPlaneServer(config: MockControlPlaneConfig) {
  const requests: Array<{ method: string; path: string; body?: any }> = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/v1/status" && config.onStatus) {
      requests.push({ method: "GET", path: `${url.pathname}${url.search}` });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config.onStatus(url), null, 2) + "\n");
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/v1/records" && config.onRecord) {
      requests.push({ method: "GET", path: `${url.pathname}${url.search}` });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config.onRecord(url), null, 2) + "\n");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/v1/run-actions" && config.onRunAction) {
      const body = await readJsonBody(request);
      requests.push({ method: "POST", path: url.pathname, body });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config.onRunAction(body), null, 2) + "\n");
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
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("deploy --status and --print-run-lock-scope read service-backed run details without raw HTTP", async () => {
  await runInTemp("deploy-control-plane-status-helper", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const mock = await startMockControlPlaneServer({
      onStatus: (url) => ({
        schemaVersion: "deployment-control-plane-status@1",
        submissionId: url.searchParams.get("submissionId") || "submission-123",
        submittedAt: "2026-04-16T12:00:00Z",
        deploymentId: "demoapp-dev",
        deploymentLabel,
        operationKind: "deploy",
        providerTargetIdentity: "nixos-shared-host:default:demoapp",
        lockScope: "nixos-shared-host:default:demoapp",
        lifecycleState: "waiting_for_lock",
        terminationReason: null,
        deployRunId: url.searchParams.get("deployRunId") || "deploy-run-123",
        dedupe: { mode: "created", requestFingerprint: "sha256:status" },
      }),
    });
    try {
      const statusResult = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --status --submission-id submission-123 --control-plane-url ${mock.url}`;
      const status = JSON.parse(String(statusResult.stdout));
      assert.equal(status.submissionId, "submission-123");
      assert.equal(status.lockScope, "nixos-shared-host:default:demoapp");

      const lockScopeResult = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --print-run-lock-scope --deploy-run-id deploy-run-123 --control-plane-url ${mock.url}`;
      assert.equal(String(lockScopeResult.stdout).trim(), "nixos-shared-host:default:demoapp");
      assert.equal(mock.requests[0]?.path, "/api/v1/status?submissionId=submission-123");
      assert.equal(mock.requests[1]?.path, "/api/v1/status?deployRunId=deploy-run-123");
    } finally {
      await mock.close();
    }
  });
});

test("deploy --record reads the finalized run record through the control-plane helper", async () => {
  await runInTemp("deploy-control-plane-record-helper", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const mock = await startMockControlPlaneServer({
      onRecord: (url) => ({
        deployRunId: url.searchParams.get("deployRunId") || "deploy-run-123",
        finalOutcome: "succeeded",
        controlPlane: { lockScope: "nixos-shared-host:default:demoapp" },
      }),
    });
    try {
      const recordResult = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --record --deploy-run-id deploy-run-123 --control-plane-url ${mock.url}`;
      const record = JSON.parse(String(recordResult.stdout));
      assert.equal(record.deployRunId, "deploy-run-123");
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      assert.equal(mock.requests[0]?.path, "/api/v1/records?deployRunId=deploy-run-123");
    } finally {
      await mock.close();
    }
  });
});

test("deploy --approve uses the installed profile and status bindings instead of hand-written run-action JSON", async () => {
  await runInTemp("deploy-control-plane-approve-helper", async (tmp, $) => {
    const profileRoot = path.join(tmp, "profiles");
    await writeTempListedDeploymentWorkspace(tmp);
    const mock = await startMockControlPlaneServer({
      onStatus: () => ({
        schemaVersion: "deployment-control-plane-status@1",
        submissionId: "submission-approval-123",
        submittedAt: "2026-04-16T12:00:00Z",
        deploymentId: "demoapp-dev",
        deploymentLabel,
        operationKind: "deploy",
        providerTargetIdentity: "nixos-shared-host:default:demoapp",
        lockScope: "nixos-shared-host:default:demoapp",
        lifecycleState: "pending_approval",
        terminationReason: null,
        deployRunId: "deploy-run-approval-123",
        dedupe: { mode: "created", requestFingerprint: "sha256:pending" },
        approval: {
          state: "pending",
          approvalNames: ["human/dev"],
          payloadFingerprint: "sha256:payload-from-status",
          targetIdentity: "nixos-shared-host:default:demoapp",
          provisionerPlanFingerprint: "sha256:plan-from-status",
        },
      }),
      onRunAction: (body) => ({
        schemaVersion: "deployment-control-plane-run-action-response@1",
        submissionId: body.submissionId,
        submittedAt: "2026-04-16T12:05:00Z",
        deploymentId: "demoapp-dev",
        deploymentLabel,
        operationKind: "deploy",
        providerTargetIdentity: "nixos-shared-host:default:demoapp",
        lockScope: "nixos-shared-host:default:demoapp",
        lifecycleState: "waiting_for_lock",
        terminationReason: null,
        deployRunId: "deploy-run-approval-123",
        dedupe: { mode: "created", requestFingerprint: "sha256:approve" },
        actionId: body.actionId,
        action: body.action,
        approval: {
          state: "granted",
          approvalNames: ["human/dev"],
          payloadFingerprint: "sha256:payload-from-status",
          targetIdentity: "nixos-shared-host:default:demoapp",
          provisionerPlanFingerprint: "sha256:plan-from-status",
          approvalId: body.approval.approvalId,
        },
        latestAction: {
          actionId: body.actionId,
          action: body.action,
          submittedAt: body.submittedAt,
          dedupe: { mode: "created", requestFingerprint: "sha256:approve" },
          lifecycleState: "waiting_for_lock",
        },
      }),
    });
    try {
      await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${profileRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url ${mock.url}`;
      const approveResult = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deploymentLabel} --profile mini --profile-root ${profileRoot} --approve --deploy-run-id deploy-run-approval-123 --approval-id ticket-123 --requested-by-principal user:reviewer`;
      const approved = JSON.parse(String(approveResult.stdout));
      assert.equal(approved.deployRunId, "deploy-run-approval-123");
      assert.equal(approved.lifecycleState, "waiting_for_lock");
      assert.equal(approved.approval.state, "granted");
      assert.equal(approved.approval.approvalId, "ticket-123");
      assert.equal(approved.latestAction.action, "approve");

      const runActionRequest = mock.requests.find((entry) => entry.method === "POST")?.body;
      assert.equal(runActionRequest.action, "approve");
      assert.equal(runActionRequest.submissionId, "submission-approval-123");
      assert.equal(runActionRequest.approval.approvalId, "ticket-123");
      assert.equal(
        runActionRequest.approval.expectedPayloadFingerprint,
        "sha256:payload-from-status",
      );
      assert.equal(
        runActionRequest.approval.expectedTargetIdentity,
        "nixos-shared-host:default:demoapp",
      );
      assert.equal(
        runActionRequest.approval.expectedProvisionerPlanFingerprint,
        "sha256:plan-from-status",
      );
      assert.equal(runActionRequest.requestedBy.principalId, "user:reviewer");
    } finally {
      await mock.close();
    }
  });
});
