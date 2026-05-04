#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { installNixosSharedHostClient } from "../../deployments/nixos-shared-host-install-dev-machine";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { runInTemp } from "../lib/test-helpers";

async function startMockControlPlaneServer(config: { onStatus: (url: URL) => unknown }) {
  const requests: Array<{ method: string; path: string }> = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      requests.push({ method: "GET", path: `${url.pathname}${url.search}` });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(config.onStatus(url), null, 2) + "\n");
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

test("deploy --status can use an installed service profile for Cloudflare Pages", async () => {
  await runInTemp("deploy-cloudflare-status-profile", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    await installCloudflarePagesTargets(tmp, [deployment]);
    const mock = await startMockControlPlaneServer({
      onStatus: (url) => ({
        schemaVersion: "deployment-control-plane-status@1",
        submissionId: url.searchParams.get("submissionId") || "submission-123",
        submittedAt: "2026-04-16T12:00:00Z",
        deploymentId: deployment.deploymentId,
        deploymentLabel: deployment.label,
        operationKind: "deploy",
        providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
        lockScope: deployment.providerTarget.providerTargetIdentity,
        lifecycleState: "running",
        terminationReason: null,
        dedupe: { mode: "created", requestFingerprint: "sha256:status" },
      }),
    });
    const profileRoot = path.join(tmp, "profiles");
    await installNixosSharedHostClient({
      outputRoot: profileRoot,
      toolFingerprint: "test",
      input: {
        profileName: "mini",
        destination: "root@mini.test",
        remoteRepoPath: "/srv/common",
        remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
        remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
        remoteRecordsRoot: "/var/lib/deployment-host/records",
        sshMode: "ssh",
        controlPlaneUrl: mock.url,
      },
    });
    try {
      const statusResult = await $({
        cwd: tmp,
        env: { ...process.env, [LOCAL_FIXTURE_SERVICE_ENV]: "1" },
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --status --submission-id submission-123 --profile mini --profile-root ${profileRoot}`;
      const status = JSON.parse(String(statusResult.stdout));
      assert.equal(status.submissionId, "submission-123");
      assert.equal(status.providerTargetIdentity, deployment.providerTarget.providerTargetIdentity);
      assert.equal(mock.requests[0]?.path, "/api/v1/status?submissionId=submission-123");
    } finally {
      await mock.close();
    }
  });
});
