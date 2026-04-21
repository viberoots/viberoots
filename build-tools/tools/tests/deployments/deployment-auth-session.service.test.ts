#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import {
  createDeploymentAuthLoginViaService,
  readDeploymentAuthSessionViaService,
} from "../../deployments/nixos-shared-host-control-plane-client.ts";
import { shouldUseServiceOwnedInteractiveAuth } from "../../deployments/deployment-service-auth-client.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function callback(url: string, loginUrl: string, code = "login-code") {
  const login = new URL(loginUrl);
  const request = new URL("/oidc/callback", url);
  request.searchParams.set("code", code);
  request.searchParams.set("state", login.searchParams.get("state") || "");
  return await fetch(request);
}

function deployment(issuer: string) {
  return {
    ...nixosSharedHostDeploymentFixture(),
    vaultRuntime: {
      oidcIssuer: issuer,
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
}

test("deployment service owns PKCE login sessions and public OIDC callback", async () => {
  await runInTemp("deployment-auth-session-service", async (tmp) => {
    const oidc = await startFakeOidcServer({
      claims: { sub: "human-1", preferred_username: "Ada", groups: ["deployers"] },
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
    });
    try {
      const login = await createDeploymentAuthLoginViaService({
        controlPlaneUrl: controlPlane.url,
        request: { deployment: target, operationKind: "deploy" },
      });
      const loginUrl = new URL(login.loginUrl);
      assert.equal(
        loginUrl.searchParams.get("redirect_uri"),
        "https://deploy-auth.apps.kilty.io/oidc/callback",
      );
      assert.equal((await callback(controlPlane.url, login.loginUrl)).status, 200);
      const status = await readDeploymentAuthSessionViaService({
        controlPlaneUrl: controlPlane.url,
        sessionId: login.sessionId,
      });
      assert.equal(status.status, "authenticated");
      assert.equal(status.principal?.principalId, "oidc:human-1");
      assert.equal(status.authorization?.requestedBy.principalId, "oidc:human-1");
      assert.equal(
        oidc.tokenRequests.at(-1)?.get("redirect_uri"),
        "https://deploy-auth.apps.kilty.io/oidc/callback",
      );
      assert(!JSON.stringify(status).includes("login-code"));
      assert(!JSON.stringify(status).includes("access_token"));
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});

test("deployment auth sessions fail closed for mismatches, replay, and expiry", async () => {
  await runInTemp("deployment-auth-session-fail-closed", async (tmp) => {
    const oidc = await startFakeOidcServer({ claims: { groups: ["deployers"] } });
    const target = deployment(oidc.issuer);
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths: {
        statePath: `${tmp}/platform-state.json`,
        hostRoot: `${tmp}/host`,
        recordsRoot: `${tmp}/records`,
      },
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(`${tmp}/records`),
    });
    try {
      const login = await createDeploymentAuthLoginViaService({
        controlPlaneUrl: controlPlane.url,
        request: { deployment: target, operationKind: "deploy" },
      });
      const wrong = new URL("/oidc/callback", controlPlane.url);
      wrong.searchParams.set("code", "sensitive-code");
      wrong.searchParams.set("state", "wrong-state");
      assert.equal((await fetch(wrong)).status, 400);
      assert.equal((await callback(controlPlane.url, login.loginUrl)).status, 200);
      assert.equal((await callback(controlPlane.url, login.loginUrl, "replay-code")).status, 410);

      const expiring = await createDeploymentAuthLoginViaService({
        controlPlaneUrl: controlPlane.url,
        request: { deployment: target, operationKind: "deploy", expiresInMs: 1 },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const expired = await readDeploymentAuthSessionViaService({
        controlPlaneUrl: controlPlane.url,
        sessionId: expiring.sessionId,
      });
      assert.equal(expired.status, "expired");
      assert(!JSON.stringify(expired).includes("sensitive-code"));
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});

test("protected shared-host clients select service-owned interactive auth instead of local PKCE", () => {
  const target = deployment("https://identity.apps.kilty.io/realms/deployments");
  assert.equal(shouldUseServiceOwnedInteractiveAuth({ deployment: target }), true);
  assert.equal(
    shouldUseServiceOwnedInteractiveAuth({ deployment: target, inputs: { loginBrowser: "print" } }),
    true,
  );
});
