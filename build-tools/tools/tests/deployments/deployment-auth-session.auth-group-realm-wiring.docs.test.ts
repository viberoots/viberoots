#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

async function read(rel: string) {
  return await fsp.readFile(viberootsRepoPath(rel), "utf8");
}

test("deployment auth session docs keep auth group helpers and declarative realm wiring aligned", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /deploy auth print-groups --deployment/i);
    assert.match(doc, /deploy auth explain-groups --deployment/i);
    assert.match(doc, /group shape[\s\S]*membership/i);
  }
  assert.match(bootstrapDoc, /deploy admin identity sync[\s\S]*deployment-auth-realm\.json/i);
  assert.match(bootstrapDoc, /deploymentHost\.identityProvider\.realmFiles/i);
  assert.match(bootstrapDoc, /host reconciliation/i);
  assert.match(bootstrapDoc, /existing persisted realms/i);
  assert.match(bootstrapDoc, /no longer depends on[\s\S]*manual admin-console/i);
  assert.match(
    bootstrapDoc,
    /deploy-submitters-<project>-<env>[\s\S]*deploy-admission-reporters-<project>-<env>/i,
  );
  assert.match(setupDoc, /deploymentHost\.identityProvider\.realmFiles/i);
  assert.match(setupDoc, /deploy admin identity sync[\s\S]*deployment-auth-realm\.json/i);
  assert.match(setupDoc, /existing (?:persisted )?realm/i);
  assert.match(setupDoc, /partial import/i);
  assert.match(setupDoc, /no longer require manual admin-console/i);
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /host reconciliation/i);
    assert.match(doc, /existing(?: persisted)?[\s\S]*realms?|existing realm/i);
  }
});
