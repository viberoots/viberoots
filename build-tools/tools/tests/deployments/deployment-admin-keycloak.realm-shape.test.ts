#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { reviewedDeployAdminGroupName } from "../../deployments/deployment-admin-keycloak-auth";
import { grantDeploymentAdminKeycloakUser } from "../../deployments/deployment-admin-keycloak";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";

async function withTempDir<T>(name: string, fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    return await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

test("deploy admin grant-user auto-syncs stale reviewed realm shape only when authorized", async () => {
  const deployment = cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    environmentStage: "dev",
  });
  const membershipAdmin = reviewedDeployAdminGroupName("membership_admin", {
    kind: "project",
    value: "sample-webapp",
  });
  const shapeAdmin = reviewedDeployAdminGroupName("shape_admin", {
    kind: "project",
    value: "sample-webapp",
  });
  await withTempDir("deploy-admin-keycloak-stale-realm", async (tmp) => {
    const realmFile = path.join(tmp, "deployment-auth-realm.json");
    const membershipFile = path.join(tmp, "deployment-auth-memberships.json");
    await fsp.writeFile(
      realmFile,
      JSON.stringify({ realm: "deployments", enabled: true, groups: [], clients: [] }) + "\n",
    );
    await assert.rejects(
      async () =>
        await grantDeploymentAdminKeycloakUser({
          deployment,
          action: "submit",
          userEmail: "reviewer@example.com",
          membershipFile,
          realmFile,
          actingPrincipal: "user:membership-admin",
          adminGroups: [membershipAdmin],
        }),
      /requires group deploy-submitters-sample-webapp-dev/,
    );
    const granted = await grantDeploymentAdminKeycloakUser({
      deployment,
      deploymentsForRealm: [deployment],
      action: "submit",
      userEmail: "reviewer@example.com",
      membershipFile,
      realmFile,
      actingPrincipal: "user:shape-and-membership-admin",
      adminGroups: [membershipAdmin, shapeAdmin],
    });
    assert.equal(granted.reviewedRealmShape?.status, "auto_synced");
    assert.match(await fsp.readFile(realmFile, "utf8"), /deploy-submitters-sample-webapp-dev/);
    assert.match(await fsp.readFile(membershipFile, "utf8"), /reviewer@example\.com/);
  });
});
