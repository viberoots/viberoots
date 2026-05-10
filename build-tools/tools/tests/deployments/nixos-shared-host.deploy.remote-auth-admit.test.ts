#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { runInTemp } from "../lib/test-helpers";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";
import {
  freshRemoteExecBuckEnv,
  installClientProfile,
  prepareRemoteExecFixture,
  requirePleominoDevCheck,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import { enableInteractivePkceVaultRuntime } from "./deployment-admin-keycloak.remote-profile.pr98.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

async function completePendingAuthSession(controlPlaneUrl: string, recordsRoot: string) {
  const authDir = path.join(recordsRoot, "control-plane", "auth-sessions");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      for (const entry of await fsp.readdir(authDir)) {
        if (!entry.endsWith(".json")) continue;
        const parsed = JSON.parse(await fsp.readFile(path.join(authDir, entry), "utf8")) as {
          status?: string;
          state?: string;
        };
        if (parsed.status !== "pending" || !parsed.state) continue;
        const callbackUrl = new URL("/oidc/callback", controlPlaneUrl);
        callbackUrl.searchParams.set("code", "login-code");
        callbackUrl.searchParams.set("state", parsed.state);
        const response = await fetch(callbackUrl);
        assert.equal(response.status, 200, await response.text());
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for pending auth session");
}

test("remote profile admit-and-deploy fails closed when the authenticated submitter lacks admission_reporter", async () => {
  await runInTemp("nixos-shared-host-remote-auth-session-admit-and-deploy", async (tmp, $) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        preferred_username: "Ada",
        groups: ["deploy-submitters-pleomino-dev"],
      },
    });
    const fixture = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>pleomino</html>\n", healthz: "ok\n" },
    });
    await requirePleominoDevCheck(tmp);
    await enableInteractivePkceVaultRuntime(tmp, oidc.issuer);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: fixture.remoteStatePath,
        hostRoot: fixture.remoteRuntimeRoot,
        recordsRoot: fixture.remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(fixture.remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: fixture.remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(fixture.remoteRecordsRoot),
    });
    const server = await startNixosSharedHostPublicServer({
      deployment: fixture.deployment,
      hostRoot: fixture.remoteRuntimeRoot,
    });
    try {
      await installClientProfile(
        $,
        fixture.profileRoot,
        tmp,
        fixture.remoteStatePath,
        fixture.remoteRuntimeRoot,
        fixture.remoteRecordsRoot,
        controlPlane.url,
      );
      const resultPromise = $({
        cwd: tmp,
        env: freshRemoteExecBuckEnv(tmp, remoteExecEnv(fixture.env)),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --artifact-dir ${fixture.artifactDir} --admit-and-deploy deploy/pleomino-dev --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const result = await resultPromise;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /admission_reporter/);
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
      await oidc.close();
    }
  });
});
