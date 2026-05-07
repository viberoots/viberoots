#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
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
  freshKeycloakBuckIsolation,
  membershipFileFor,
  realmFileFor,
} from "./deployment-admin-keycloak.remote-profile.pr98.helpers";

test("remote profile sync infers acting principal and admin groups from the reviewed session", async () => {
  await runInTemp("deploy-admin-keycloak-pr98-sync", async (tmp, $) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
        groups: ["deploy-admin-keycloak-shape-admin-project-pleomino"],
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
        env: remoteExecEnv(fixture.env, {
          BUCK_NESTED_ISO: freshKeycloakBuckIsolation(tmp),
        }),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak sync --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)}`;
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const summary = JSON.parse(String((await resultPromise).stdout));
      assert.equal(summary.executionMode, "remote-profile");
      assert.equal(
        summary.mutation.audit.inputResolution.actingPrincipal.principalId,
        "oidc:human-1",
      );
      assert.equal(summary.mutation.audit.inputResolution.actingPrincipal.source, "session");
      assert.equal(summary.mutation.audit.inputResolution.adminGroups.source, "session");
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});

test("remote profile grant-user defaults self-service grants to the logged-in email and records explicit cross-user overrides", async () => {
  await runInTemp("deploy-admin-keycloak-pr98-grant-user", async (tmp, $) => {
    const oidc = await startFakeOidcServer({
      claims: {
        sub: "human-1",
        email: "ada@example.com",
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
      const remoteConfigRoot = configRootFor(tmp);
      await fsp.mkdir(path.dirname(realmFileFor(remoteConfigRoot)), { recursive: true });
      await fsp.writeFile(
        realmFileFor(remoteConfigRoot),
        JSON.stringify(
          {
            realm: "deployments",
            enabled: true,
            groups: [
              { name: "deploy-submitters-pleomino-dev" },
              { name: "deploy-approvers-pleomino-dev" },
            ],
            clients: [],
          },
          null,
          2,
        ) + "\n",
      );
      const selfPromise = $({
        cwd: tmp,
        env: remoteExecEnv(fixture.env, {
          BUCK_NESTED_ISO: freshKeycloakBuckIsolation(tmp),
        }),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${remoteConfigRoot} --action submit`;
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const selfSummary = JSON.parse(String((await selfPromise).stdout));
      assert.equal(
        selfSummary.mutation.audit.inputResolution.targetUser.userEmail,
        "ada@example.com",
      );
      assert.equal(selfSummary.mutation.audit.inputResolution.targetUser.source, "session");
      assert.match(
        await fsp.readFile(membershipFileFor(remoteConfigRoot), "utf8"),
        /ada@example\.com/,
      );

      const crossPromise = $({
        cwd: tmp,
        env: remoteExecEnv(fixture.env, {
          BUCK_NESTED_ISO: freshKeycloakBuckIsolation(tmp),
        }),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${remoteConfigRoot} --action approve --user-email alice@example.com`;
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const crossSummary = JSON.parse(String((await crossPromise).stdout));
      assert.equal(
        crossSummary.mutation.audit.inputResolution.targetUser.userEmail,
        "alice@example.com",
      );
      assert.equal(crossSummary.mutation.audit.inputResolution.targetUser.source, "explicit");
      assert.match(
        await fsp.readFile(membershipFileFor(remoteConfigRoot), "utf8"),
        /alice@example\.com/,
      );
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});
