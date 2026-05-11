#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("deployment auth session docs keep reviewed remote keycloak admin flow aligned across operator docs", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc]) {
    assert.match(doc, /deploy admin identity sync[\s\S]*--profile mini/i);
    assert.match(doc, /deploy admin identity grant-user[\s\S]*--profile mini/i);
    assert.match(doc, /deployment-host\/identity-provider\/deployment-auth-realm\.json/i);
    assert.match(doc, /deployment-host\/identity-provider\/deployment-auth-memberships\.json/i);
  }
  assert.match(
    setupDoc,
    /generatedImportRoot[\s\S]*defaults to\s+`\/etc\/nixos\/deployment-host\/identity-provider`/i,
  );
  assert.match(
    setupDoc,
    /flake evaluation pure|keeps flake evaluation pure/i,
    "setup guide must explain the pure-flake config-root reason for the reviewed artifact placement",
  );
  assert.match(
    setupDoc,
    /gitignored[\s\S]*runtime-links|runtime-links[\s\S]*gitignored/i,
    "setup guide must explain that generated Keycloak JSON stays gitignored and is linked at runtime",
  );
});
