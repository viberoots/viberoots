#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("pr95 docs keep deploy auth group helpers and declarative realm wiring aligned", async () => {
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
  assert.match(bootstrapDoc, /deploy auth print-keycloak-realm/i);
  assert.match(bootstrapDoc, /deploymentHost\.identityProvider\.realmFiles/i);
  assert.match(
    bootstrapDoc,
    /deploy-submitters-<project>-<env>[\s\S]*deploy-admission-reporters-<project>-<env>/i,
  );
  assert.match(setupDoc, /deploymentHost\.identityProvider\.realmFiles/i);
  assert.match(setupDoc, /deploy auth print-keycloak-realm/i);
});
