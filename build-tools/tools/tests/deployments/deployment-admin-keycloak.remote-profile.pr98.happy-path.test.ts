#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
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
  membershipFileFor,
  realmFileFor,
} from "./deployment-admin-keycloak.remote-profile.pr98.helpers.ts";

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
        env: remoteExecEnv(fixture.env),
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
      await fsp.mkdir(path.dirname(realmFileFor(tmp)), { recursive: true });
      await fsp.writeFile(
        realmFileFor(tmp),
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
        env: remoteExecEnv(fixture.env),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action submit`;
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const selfSummary = JSON.parse(String((await selfPromise).stdout));
      assert.equal(
        selfSummary.mutation.audit.inputResolution.targetUser.userEmail,
        "ada@example.com",
      );
      assert.equal(selfSummary.mutation.audit.inputResolution.targetUser.source, "session");
      assert.match(await fsp.readFile(membershipFileFor(tmp), "utf8"), /ada@example\.com/);

      const crossPromise = $({
        cwd: tmp,
        env: remoteExecEnv(fixture.env),
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts admin keycloak grant-user --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --remote-config-root ${configRootFor(tmp)} --action approve --user-email alice@example.com`;
      await completePendingAuthSession(controlPlane.url, fixture.remoteRecordsRoot);
      const crossSummary = JSON.parse(String((await crossPromise).stdout));
      assert.equal(
        crossSummary.mutation.audit.inputResolution.targetUser.userEmail,
        "alice@example.com",
      );
      assert.equal(crossSummary.mutation.audit.inputResolution.targetUser.source, "explicit");
      assert.match(await fsp.readFile(membershipFileFor(tmp), "utf8"), /alice@example\.com/);
    } finally {
      await controlPlane.close();
      await oidc.close();
    }
  });
});
