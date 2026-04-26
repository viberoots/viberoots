#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers.ts";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers.ts";
import {
  completePendingAuthSession,
  configRootFor,
  CONTROL_PLANE_TOKEN,
  enableInteractivePkceVaultRuntime,
} from "./deployment-admin-keycloak.remote-profile.pr98.helpers.ts";

test("remote profile grant-user fails closed with concise authz guidance", async () => {
  await runInTemp("deploy-admin-keycloak-pr98-errors", async (tmp, $) => {
    const fixture = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>ok</html>\n" },
    });
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        groups: ["deploy-submitters-pleomino-dev"],
      },
    });
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
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action submit`.nothrow();
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const result = await resultPromise;
      assert.notEqual(result.exitCode, 0);
      assert.match(
        String(result.stderr),
        /current login oidc:human-1 \(ada@example\.com\) lacks reviewed Keycloak membership admin for submit/i,
      );
      assert.match(
        String(result.stderr),
        /deploy admin keycloak grant-user --deployment .* --profile mini --action submit --user-email ada@example\.com --apply-host/i,
      );
      assert.doesNotMatch(String(result.stderr), /--acting-principal/i);
      assert.doesNotMatch(String(result.stderr), /--admin-group/i);
      assert.doesNotMatch(String(result.stderr), /--membership-file/i);
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});

test("remote profile self-service grant explains when an explicit target user is still required", async () => {
  await runInTemp("deploy-admin-keycloak-pr98-missing-email", async (tmp, $) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-2",
        preferred_username: "Ada",
        groups: ["deploy-admin-keycloak-membership-admin-project-pleomino"],
      },
    });
    const fixture = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>ok</html>\n" },
    });
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
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action submit`.nothrow();
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const result = await resultPromise;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /self-service grant could not infer a user email/i);
      assert.match(String(result.stderr), /rerun with --user-email <user@example\.com>/i);
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});
