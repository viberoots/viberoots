#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop.ts";
import { createNixosSharedHostRemotePlan } from "../../deployments/nixos-shared-host-remote-target.ts";
import { runNixosSharedHostRemoteDeploy } from "../../deployments/nixos-shared-host-remote-execution.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import { withEnvOverrides, waitFor } from "./nixos-shared-host.control-plane.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";

async function completePendingAuthSession(controlPlaneUrl: string, recordsRoot: string) {
  const session = await waitFor(async () => {
    const authDir = path.join(recordsRoot, "control-plane", "auth-sessions");
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(authDir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const parsed = JSON.parse(await fsp.readFile(path.join(authDir, entry), "utf8")) as {
        status?: string;
        state?: string;
      };
      if (parsed.status === "pending" && parsed.state) return parsed.state;
    }
    return null;
  }, "timed out waiting for pending auth session");
  const callbackUrl = new URL("/oidc/callback", controlPlaneUrl);
  callbackUrl.searchParams.set("code", "login-code");
  callbackUrl.searchParams.set("state", session);
  const response = await fetch(callbackUrl);
  assert.equal(response.status, 200, await response.text());
}

test("remote profile deploy creates a service-owned auth session for interactive protected runs", async () => {
  await runInTemp("nixos-shared-host-remote-auth-session", async (tmp, $) => {
    const oidc = await startFakeOidcServer({
      claims: { sub: "human-1", preferred_username: "Ada", groups: ["deployers"] },
    });
    const {
      deployment,
      env,
      artifactDir,
      admissionEvidencePath,
      profileRoot,
      remoteRuntimeRoot,
      remoteRecordsRoot,
      remoteStatePath,
    } = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>pleomino</html>\n", healthz: "ok\n" },
    });
    const authDeployment = {
      ...deployment,
      vaultRuntime: {
        oidcIssuer: oidc.issuer,
        audience: "deployments-vault",
        cliPublicClientId: "deployment-cli",
        deploymentEnvironment: "mini",
        preferredCredentialSource: "interactive_pkce" as const,
        requiredHumanClaim: "groups",
        requiredHumanClaimValue: "deployers",
        pkceCallback: {
          mode: "public_host",
          externalScheme: "https",
          externalHost: "deploy-auth.apps.kilty.io",
          externalPath: "/oidc/callback",
          bindHost: "127.0.0.1",
          bindPort: 7780,
          bindPath: "/oidc/callback",
        },
      },
    };
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
    });
    const server = await startNixosSharedHostPublicServer({
      deployment: authDeployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      await installClientProfile(
        $,
        profileRoot,
        tmp,
        remoteStatePath,
        remoteRuntimeRoot,
        remoteRecordsRoot,
        controlPlane.url,
      );
      const plan = await createNixosSharedHostRemotePlan({
        deployment: authDeployment,
        profileName: "mini",
        profileRoot,
        artifactDir,
      });
      const summaryPromise = withEnvOverrides(
        remoteExecEnv(env),
        async () =>
          await runNixosSharedHostRemoteDeploy({
            deployment: authDeployment,
            plan,
            localArtifactDir: artifactDir,
            retainRemoteArtifact: false,
            vaultRuntimeInputs: { loginBrowser: "print" },
            admissionEvidence: JSON.parse(await fsp.readFile(admissionEvidencePath, "utf8")),
            smokeConnectOverride: {
              protocol: "https:",
              hostname: "127.0.0.1",
              port: server.port,
              rejectUnauthorized: false,
            },
          }),
      );
      await completePendingAuthSession(controlPlane.url, remoteRecordsRoot);
      const summary = await summaryPromise;
      assert.equal(summary.executionMode, "remote-profile");
      assert.equal(summary.controlPlane.finalOutcome, "succeeded");
      assert.equal(summary.deploymentLabel, REVIEWED_PLEOMINO_DEPLOYMENT_LABEL);
      assert.equal(oidc.tokenRequests.length > 0, true);
    } finally {
      await worker.close();
      await controlPlane.close();
      await server.close();
      await oidc.close();
    }
  });
});
