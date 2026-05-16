#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { createNixosSharedHostRemotePlan } from "../../deployments/nixos-shared-host-remote-target";
import { runNixosSharedHostRemoteDeploy } from "../../deployments/nixos-shared-host-remote-execution";
import { runInTemp } from "../lib/test-helpers";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";
import { findPendingAuthSessionState } from "./deployment-admin-keycloak.remote-profile.helpers";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { withEnvOverrides, waitFor } from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";
async function completePendingAuthSession(controlPlaneUrl: string, recordsRoot: string) {
  const session = await waitFor(async () => {
    return await findPendingAuthSessionState(recordsRoot);
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
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        preferred_username: "Ada",
        groups: ["deploy-submitters-pleomino-dev"],
      },
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
    const objectStore = memoryControlPlaneArtifactStore();
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: remoteStatePath,
        hostRoot: remoteRuntimeRoot,
        recordsRoot: remoteRecordsRoot,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      token: CONTROL_PLANE_TOKEN,
      objectStore,
    });
    const worker = startNixosSharedHostControlPlaneWorkerLoop({
      workspaceRoot: tmp,
      recordsRoot: remoteRecordsRoot,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(remoteRecordsRoot),
      objectStore,
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
