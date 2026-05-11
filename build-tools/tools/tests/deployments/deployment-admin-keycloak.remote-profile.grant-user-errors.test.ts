#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import { startFakeOidcServer } from "./deploy-vault-jwt.test-helpers";
import {
  installClientProfile,
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import {
  completePendingAuthSession,
  configRootFor,
  CONTROL_PLANE_TOKEN,
  enableInteractivePkceVaultRuntime,
  freshKeycloakBuckEnv,
} from "./deployment-admin-keycloak.remote-profile.helpers";

test("remote profile grant-user reviewed auth errors", async (t) => {
  await runInTemp("deploy-admin-keycloak-grant-user-errors", async (tmp, $) => {
    const fixture = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>ok</html>\n" },
    });

    await t.test("fails closed with concise authz guidance", async () => {
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
          env: freshKeycloakBuckEnv(tmp, remoteExecEnv(fixture.env)),
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action submit`.nothrow();
        await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
        const result = await resultPromise;
        assert.notEqual(result.exitCode, 0);
        assert.match(
          String(result.stderr),
          /current login oidc:human-1 \(ada@example\.com\) lacks reviewed identity membership admin for submit/i,
        );
        assert.match(
          String(result.stderr),
          /deploy admin identity grant-user --deployment .* --profile mini --action submit --user-email ada@example\.com --apply-host/i,
        );
        assert.doesNotMatch(String(result.stderr), /--acting-principal/i);
        assert.doesNotMatch(String(result.stderr), /--admin-group/i);
        assert.doesNotMatch(String(result.stderr), /--membership-file/i);
      } finally {
        await controlPlane.close();
        await oidc.close();
      }
    });

    await t.test("fails closed when the reviewed auth session omits email", async () => {
      const oidc = await startFakeOidcServer({
        claims: {
          sub: "human-2",
          preferred_username: "Ada",
          groups: ["deploy-admin-keycloak-membership-admin-project-pleomino"],
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
          env: freshKeycloakBuckEnv(tmp, remoteExecEnv(fixture.env)),
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action submit`.nothrow();
        await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot, 400);
        const result = await resultPromise;
        assert.notEqual(result.exitCode, 0);
        assert.match(
          String(result.stderr),
          /interactive deployment auth requires an authoritative email/i,
        );
        assert.match(
          String(result.stderr),
          /update the reviewed identity claim mapper to include email and retry/i,
        );
      } finally {
        await controlPlane.close();
        await oidc.close();
      }
    });
  });
});
