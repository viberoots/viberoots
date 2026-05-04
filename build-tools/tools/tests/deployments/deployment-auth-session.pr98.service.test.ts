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

test("auth session status exposes reviewed identity admin groups and principal email", async () => {
  await runInTemp("deployment-auth-session-pr98-service", async (tmp) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        groups: [
          "deploy-submitters-pleomino-dev",
          "deploy-admin-keycloak-membership-admin-project-pleomino",
          "deploy-admin-keycloak-shape-admin-global",
        ],
      },
    });
    const deployment = {
      ...nixosSharedHostDeploymentFixture({
        deploymentId: "pleomino-dev",
        label: "//projects/deployments/pleomino-dev:deploy",
        lanePolicyRef: "//projects/deployments/pleomino-shared:lane",
        environmentStage: "dev",
      }),
      vaultRuntime: {
        oidcIssuer: oidc.issuer,
        audience: "deployments-vault",
        cliPublicClientId: "deployment-cli",
        deploymentEnvironment: "mini",
        preferredCredentialSource: "interactive_pkce" as const,
      },
    };
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
        request: { deployment, operationKind: "deploy-admin-identity-sync" },
      });
      assert.equal((await callback(controlPlane.url, login.loginUrl)).status, 200);
      const status = await readDeploymentAuthSessionViaService({
        controlPlaneUrl: controlPlane.url,
        sessionId: login.sessionId,
      });
      assert.equal(status.principal?.principalId, "oidc:human-1");
      assert.equal(status.principalEmail, "ada@example.com");
      assert.deepEqual(status.reviewedIdentityAdminGroups, [
        "deploy-admin-identity-membership-admin-project-pleomino",
        "deploy-admin-identity-shape-admin-global",
      ]);
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});
