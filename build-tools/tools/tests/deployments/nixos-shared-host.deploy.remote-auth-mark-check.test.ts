#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

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

test("remote profile mark-check-passed fails closed when the authenticated submitter lacks admission_reporter", async () => {
  await runInTemp("nixos-shared-host-remote-auth-session-mark-check-passed", async (tmp, $) => {
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
    const sharedTargetsPath = path.join(
      tmp,
      "projects",
      "deployments",
      "pleomino-shared",
      "TARGETS",
    );
    const deployTargetsPath = path.join(tmp, "projects", "deployments", "pleomino-dev", "TARGETS");
    await fsp.writeFile(
      sharedTargetsPath,
      (await fsp.readFile(sharedTargetsPath, "utf8"))
        .replace('"required_checks": "",', '"required_checks": "deploy/pleomino-dev",')
        .replace("    required_checks = [],", '    required_checks = ["deploy/pleomino-dev"],'),
      "utf8",
    );
    await fsp.writeFile(
      deployTargetsPath,
      (await fsp.readFile(deployTargetsPath, "utf8")).replace(
        '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",\n',
        [
          '    admission_policy = "//projects/deployments/pleomino-shared:dev_release",',
          "    vault_runtime = {",
          `        "oidc_issuer": ${JSON.stringify(oidc.issuer)},`,
          '        "audience": "deployments-vault",',
          '        "cli_public_client_id": "deployment-cli",',
          '        "deployment_environment": "mini",',
          '        "preferred_credential_source": "interactive_pkce",',
          '        "pkce_callback_mode": "public_host",',
          '        "pkce_callback_external_scheme": "https",',
          '        "pkce_callback_external_host": "deploy-auth.apps.kilty.io",',
          '        "pkce_callback_external_path": "/oidc/callback",',
          '        "pkce_callback_bind_host": "127.0.0.1",',
          '        "pkce_callback_bind_port": "7780",',
          '        "pkce_callback_bind_path": "/oidc/callback",',
          "    },",
        ].join("\n"),
      ),
      "utf8",
    );
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
        env: remoteExecEnv(fixture.env),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --artifact-dir ${fixture.artifactDir} --mark-check-passed deploy/pleomino-dev --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
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
