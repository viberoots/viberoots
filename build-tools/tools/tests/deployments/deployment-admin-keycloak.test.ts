#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  reviewedDeployAdminGroupName,
  type DeploymentKeycloakAdminScope,
} from "../../deployments/deployment-admin-keycloak-auth";
import {
  buildDeploymentAdminKeycloakPlan,
  grantDeploymentAdminKeycloakUser,
  syncDeploymentAdminKeycloakRealm,
} from "../../deployments/deployment-admin-keycloak";
import { reviewedHumanGroupName } from "../../deployments/deployment-auth-groups";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";

async function withTempDir<T>(name: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    return await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function adminGroup(
  role: "read" | "shape_admin" | "membership_admin",
  scope: DeploymentKeycloakAdminScope,
): string {
  return reviewedDeployAdminGroupName(role, scope);
}

test("deploy admin identity plan stays deterministic and advertises separate admin groups", () => {
  const deployment = cloudflarePagesDeploymentFixture({
    vaultRuntime: {
      audience: "deployments-vault",
      deploymentEnvironment: "mini",
      deploymentClientId: "deployment-runner",
      serviceAccountClientId: "deployment-runner",
      cliPublicClientId: "deployment-cli",
    },
  });
  const first = buildDeploymentAdminKeycloakPlan({
    deployment,
    automationPrincipalIds: ["jenkins"],
  });
  const second = buildDeploymentAdminKeycloakPlan({
    deployment,
    automationPrincipalIds: ["jenkins"],
  });
  assert.deepEqual(first, second);
  assert.match(first.adminGroupConventions.shapeAdmin[0], /deploy-admin-identity-shape-admin-/);
  assert.match(first.nextSteps.sync, /deploy admin identity sync --deployment/);
  assert.ok(first.plannedMutations.groups.includes("deploy-submitters-pleomino-staging"));
  assert.deepEqual(
    first.plannedMutations.clients.map((client) => client.clientId),
    ["deployment-cli", "deployment-runner"],
  );
  assert.deepEqual(first.plannedMutations.clients[0]?.protocolMappers, [
    "groups",
    "email",
    "audience",
    "deployment_environment",
    "repository",
  ]);
  assert.deepEqual(first.plannedMutations.clients[1]?.protocolMappers, [
    "audience",
    "deployment_environment",
    "repository",
  ]);
  assert.deepEqual(first.plannedMutations.clients[1]?.redirectUris, []);
});

test("ordinary deploy groups do not authorize deploy admin identity sync", async () => {
  const deployment = cloudflarePagesDeploymentFixture();
  await withTempDir("deploy-admin-keycloak-unauthorized-sync", async (tmp) => {
    await assert.rejects(
      async () =>
        await syncDeploymentAdminKeycloakRealm({
          deployment,
          realmFile: path.join(tmp, "realm.json"),
          actingPrincipal: "user:alice",
          adminGroups: [reviewedHumanGroupName(deployment, "submitter")],
        }),
      /shape-admin|group-shape sync/i,
    );
  });
});

test("project and environment scoped deploy admin groups stay narrow", async () => {
  const staging = cloudflarePagesDeploymentFixture();
  const otherProject = cloudflarePagesDeploymentFixture({
    deploymentId: "demoapp-staging",
    label: "//projects/deployments/demoapp-staging:deploy",
    lanePolicyRef: "//projects/deployments/demoapp-shared:lane",
  });
  const dev = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino/dev:deploy",
    environmentStage: "dev",
    admissionPolicyRef: "//projects/deployments/pleomino/shared:dev_release",
  });
  const membershipProject = adminGroup("membership_admin", { kind: "project", value: "pleomino" });
  const membershipEnv = adminGroup("membership_admin", {
    kind: "environment_stage",
    value: "staging",
  });
  await withTempDir("deploy-admin-keycloak-scope", async (tmp) => {
    const membershipFile = path.join(tmp, "memberships.json");
    await grantDeploymentAdminKeycloakUser({
      deployment: staging,
      action: "approve",
      userEmail: "alice@example.com",
      membershipFile,
      actingPrincipal: "user:alice-admin",
      adminGroups: [membershipProject],
    });
    await assert.rejects(
      async () =>
        await grantDeploymentAdminKeycloakUser({
          deployment: otherProject,
          action: "submit",
          userEmail: "bob@example.com",
          membershipFile,
          actingPrincipal: "user:alice-admin",
          adminGroups: [membershipProject],
        }),
      /membership-admin|membership mutation/i,
    );
    await grantDeploymentAdminKeycloakUser({
      deployment: staging,
      action: "submit",
      userEmail: "carol@example.com",
      membershipFile,
      actingPrincipal: "user:env-admin",
      adminGroups: [membershipEnv],
    });
    await assert.rejects(
      async () =>
        await grantDeploymentAdminKeycloakUser({
          deployment: dev,
          action: "submit",
          userEmail: "dave@example.com",
          membershipFile,
          actingPrincipal: "user:env-admin",
          adminGroups: [membershipEnv],
        }),
      /membership-admin|membership mutation/i,
    );
  });
});

test("deploy admin sync and grant-user keep audit provenance and idempotent writes", async () => {
  const deployment = cloudflarePagesDeploymentFixture({
    vaultRuntime: {
      audience: "deployments-vault",
      deploymentEnvironment: "mini",
      deploymentClientId: "deployment-runner",
      serviceAccountClientId: "deployment-runner",
      cliPublicClientId: "deployment-cli",
    },
  });
  const shapeAdmin = adminGroup("shape_admin", { kind: "project", value: "pleomino" });
  const membershipAdmin = adminGroup("membership_admin", { kind: "project", value: "pleomino" });
  await withTempDir("deploy-admin-keycloak-apply", async (tmp) => {
    const realmFile = path.join(tmp, "deployment-auth-realm.json");
    const membershipFile = path.join(tmp, "deployment-auth-memberships.json");
    const firstSync = await syncDeploymentAdminKeycloakRealm({
      deployment,
      deploymentsForRealm: [deployment],
      realmFile,
      actingPrincipal: "user:shape-admin",
      adminGroups: [shapeAdmin],
    });
    const secondSync = await syncDeploymentAdminKeycloakRealm({
      deployment,
      deploymentsForRealm: [deployment],
      realmFile,
      actingPrincipal: "user:shape-admin",
      adminGroups: [shapeAdmin],
    });
    assert.equal(firstSync.changed, true);
    assert.equal(secondSync.changed, false);
    assert.equal(firstSync.audit.actingPrincipal.principalId, "user:shape-admin");
    assert.equal(firstSync.audit.grantedScope.kind, "project");
    assert.equal(firstSync.audit.requestedMutation.kind, "identity_group_shape_sync");
    assert.match(await fsp.readFile(realmFile, "utf8"), /deploy-approvers-pleomino-staging/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /"claim\.name": "email"/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /oidc-usermodel-property-mapper/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /oidc-audience-mapper/);
    assert.match(
      await fsp.readFile(realmFile, "utf8"),
      /"included\.custom\.audience": "deployments-vault"/,
    );
    assert.match(await fsp.readFile(realmFile, "utf8"), /"claim\.name": "deployment_environment"/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /"claim\.value": "viberoots\/viberoots"/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /"clientId": "deployment-runner"/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /"serviceAccountsEnabled": true/);

    const granted = await grantDeploymentAdminKeycloakUser({
      deployment,
      action: "approve",
      userEmail: "reviewer@example.com",
      membershipFile,
      realmFile,
      actingPrincipal: "user:membership-admin",
      adminGroups: [membershipAdmin],
    });
    assert.equal(granted.audit.actingPrincipal.principalId, "user:membership-admin");
    assert.equal(granted.audit.requestedMutation.kind, "identity_membership_grant");
    assert.equal(granted.grantedUser.group, "deploy-approvers-pleomino-staging");
    assert.match(await fsp.readFile(membershipFile, "utf8"), /reviewer@example\.com/);
  });
});

test("deploy admin sync can refresh an authoritative shared realm artifact", async () => {
  const staging = cloudflarePagesDeploymentFixture();
  const dev = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino/dev:deploy",
    environmentStage: "dev",
    admissionPolicyRef: "//projects/deployments/pleomino/shared:dev_release",
  });
  const shapeAdmin = adminGroup("shape_admin", { kind: "project", value: "pleomino" });
  await withTempDir("deploy-admin-keycloak-shared-realm", async (tmp) => {
    const realmFile = path.join(tmp, "deployment-auth-realm.json");
    const synced = await syncDeploymentAdminKeycloakRealm({
      deployment: staging,
      deploymentsForRealm: [staging, dev],
      realmFile,
      actingPrincipal: "user:shape-admin",
      adminGroups: [shapeAdmin],
    });
    assert.equal(synced.renderedDeploymentCount, 2);
    assert.match(await fsp.readFile(realmFile, "utf8"), /deploy-submitters-pleomino-dev/);
    assert.match(await fsp.readFile(realmFile, "utf8"), /deploy-submitters-pleomino-staging/);
  });
});
