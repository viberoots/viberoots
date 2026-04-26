#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("pr97 docs keep reviewed remote keycloak admin flow aligned across operator docs", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc]) {
    assert.match(doc, /deploy admin keycloak sync[\s\S]*--profile mini/i);
    assert.match(doc, /deploy admin keycloak grant-user[\s\S]*--profile mini/i);
    assert.match(doc, /deployment-host\/identity-provider\/deployment-auth-realm\.json/i);
    assert.match(doc, /deployment-host\/identity-provider\/deployment-auth-memberships\.json/i);
  }
  assert.match(
    setupDoc,
    /realmFiles = \[[\s\S]*\.\/deployment-host\/identity-provider\/deployment-auth-realm\.json/i,
  );
  assert.match(
    setupDoc,
    /flake evaluation pure|keeps flake evaluation pure/i,
    "setup guide must explain the pure-flake config-root reason for the reviewed artifact placement",
  );
});
