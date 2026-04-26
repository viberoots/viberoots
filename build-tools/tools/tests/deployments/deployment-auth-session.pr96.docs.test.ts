#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("pr96 docs keep deploy admin keycloak workflows aligned across usage and setup docs", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /deploy admin keycloak plan --deployment/i);
    assert.match(doc, /deploy admin keycloak grant-user[\s\S]*--deployment/i);
    assert.match(doc, /read-only `deploy auth[\s\S]*privileged `deploy admin/i);
  }
  for (const doc of [setupDoc, bootstrapDoc]) {
    assert.match(doc, /deployment-auth-memberships\.json/i);
    assert.match(doc, /deploy-admin-keycloak-membership-admin-/i);
    assert.match(doc, /deploy admin keycloak sync[\s\S]*--deployment/i);
  }
});
