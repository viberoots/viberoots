#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import {
  createDeploymentAuthLoginViaService,
  readDeploymentAuthSessionViaService,
} from "../../deployments/nixos-shared-host-control-plane-client";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";

async function callback(url: string, loginUrl: string) {
  const login = new URL(loginUrl);
  const request = new URL("/oidc/callback", url);
  request.searchParams.set("code", "login-code");
  request.searchParams.set("state", login.searchParams.get("state") || "");
  return await fetch(request);
}

function deployment(issuer: string) {
  return {
    ...nixosSharedHostDeploymentFixture({
      deploymentId: "pleomino-dev",
      label: "//projects/deployments/pleomino/dev:deploy",
      lanePolicyRef: "//projects/deployments/pleomino/shared:lane",
      environmentStage: "dev",
    }),
    vaultRuntime: {
      oidcIssuer: issuer,
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
}

test("auth session status exposes every derived grant for the authenticated deployment context", async () => {
  await runInTemp("deployment-auth-session-derived-grants-service", async (tmp) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        preferred_username: "Ada",
        groups: [
          "deploy-submitters-pleomino-dev",
          "deploy-approvers-pleomino-dev",
          "deploy-admission-reporters-pleomino-dev",
          "deploy-submitters-pleomino-prod",
        ],
      },
    });
    const target = deployment(oidc.issuer);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: `${tmp}/platform-state.json`,
        hostRoot: `${tmp}/host`,
        recordsRoot: `${tmp}/records`,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(`${tmp}/records`),
      localFixture: true,
    });
    try {
      const login = await createDeploymentAuthLoginViaService({
        controlPlaneUrl: controlPlane.url,
        request: { deployment: target, operationKind: "deploy" },
      });
      assert.equal((await callback(controlPlane.url, login.loginUrl)).status, 200);
      const status = await readDeploymentAuthSessionViaService({
        controlPlaneUrl: controlPlane.url,
        sessionId: login.sessionId,
      });
      assert.equal(status.status, "authenticated");
      assert.deepEqual(status.authorization?.grants, [
        { role: "submitter", scope: { kind: "deployment_id", value: "pleomino-dev" } },
        { role: "approver", scope: { kind: "deployment_id", value: "pleomino-dev" } },
        { role: "admission_reporter", scope: { kind: "deployment_id", value: "pleomino-dev" } },
      ]);
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});
