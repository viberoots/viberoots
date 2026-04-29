#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRemoteDeployAdminKeycloakGrantUserScript,
  buildRemoteDeployAdminKeycloakSyncScript,
  buildRemoteSshArgv,
} from "../../deployments/nixos-shared-host-remote-shell.ts";
import {
  remoteSshCommandAssemblyPlan as plan,
  withReviewedSshEnv,
} from "./nixos-shared-host.remote-ssh.command-assembly.fixture.ts";

test("remote SSH transport assembles reviewed deploy admin identity sync commands", () => {
  withReviewedSshEnv(() => {
    const sync = buildRemoteSshArgv(
      plan.destination,
      buildRemoteDeployAdminKeycloakSyncScript({
        plan,
        deploymentLabel: plan.deploymentLabel,
        realmFile: "/etc/nixos/deployment-host/identity-provider/deployment-auth-realm.json",
        actingPrincipal: "user:shape-admin",
        adminGroups: ["deploy-admin-identity-shape-admin-project-pleomino"],
        automationPrincipalIds: ["app:deploy-bot"],
      }),
    );
    assert.match(sync.at(-1) || "", /build-tools\/tools\/bin\/deploy admin identity sync/);
    assert.match(
      sync.at(-1) || "",
      /--realm-file '"'"'\/etc\/nixos\/deployment-host\/identity-provider\/deployment-auth-realm\.json'"'"'/,
    );
    assert.match(sync.at(-1) || "", /--automation-principal .*app:deploy-bot/);
  });
});

test("remote SSH transport assembles reviewed deploy admin identity grant-user commands", () => {
  withReviewedSshEnv(() => {
    const grant = buildRemoteSshArgv(
      plan.destination,
      buildRemoteDeployAdminKeycloakGrantUserScript({
        plan,
        deploymentLabel: plan.deploymentLabel,
        action: "submit",
        userEmail: "alice@example.com",
        membershipFile:
          "/etc/nixos/deployment-host/identity-provider/deployment-auth-memberships.json",
        realmFile: "/etc/nixos/deployment-host/identity-provider/deployment-auth-realm.json",
        actingPrincipal: "user:membership-admin",
        adminGroups: ["deploy-admin-identity-membership-admin-project-pleomino"],
        automationPrincipalIds: ["app:deploy-bot"],
      }),
    );
    assert.match(grant.at(-1) || "", /build-tools\/tools\/bin\/deploy admin identity grant-user/);
    assert.match(grant.at(-1) || "", /--user-email .*alice@example\.com/);
    assert.match(grant.at(-1) || "", /--membership-file .*deployment-auth-memberships\.json/);
    assert.match(grant.at(-1) || "", /--realm-file .*deployment-auth-realm\.json/);
    assert.match(grant.at(-1) || "", /--automation-principal .*app:deploy-bot/);
  });
});
