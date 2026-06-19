#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

async function read(rel: string) {
  return await fsp.readFile(viberootsRepoPath(rel), "utf8");
}

test("deployment auth session docs keep admin identity workflows aligned across usage and setup docs", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /deploy admin identity plan --deployment/i);
    assert.match(doc, /deploy admin identity grant-user[\s\S]*--deployment/i);
    assert.match(doc, /read-only `deploy auth[\s\S]*privileged `deploy admin/i);
  }
  for (const doc of [setupDoc, bootstrapDoc]) {
    assert.match(doc, /deployment-auth-memberships\.json/i);
    assert.match(doc, /deploy-admin-identity-membership-admin-/i);
    assert.match(doc, /deploy admin identity sync[\s\S]*--deployment/i);
  }
});
