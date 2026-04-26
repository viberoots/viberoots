#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

function docHasAny(doc: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(doc));
}

test("pr98 docs shorten the reviewed remote Keycloak admin happy path", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/vault-production-bootstrap.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc, setupDoc, bootstrapDoc]) {
    assert.match(doc, /deploy admin keycloak sync[\s\S]*--profile mini/i);
    assert.match(
      doc,
      /deploy admin keycloak grant-user[\s\S]*--profile mini[\s\S]*--action submit/i,
    );
    assert.match(doc, /omit `--user-email`/i);
    assert.ok(
      docHasAny(doc, [
        /self-service/i,
        /grant yourself/i,
        /themself/i,
        /current login/i,
        /logged-in human/i,
      ]),
    );
    assert.match(doc, /--user-email alice@example\.com/i);
    assert.ok(
      docHasAny(doc, [/cross-user/i, /another user/i, /another human/i, /break-glass recovery/i]),
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak sync[\s\S]{0,220}--profile mini[\s\S]{0,220}--acting-principal/i,
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak sync[\s\S]{0,220}--profile mini[\s\S]{0,220}--admin-group/i,
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak sync[\s\S]{0,220}--profile mini[\s\S]{0,220}--realm-file/i,
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak grant-user[\s\S]{0,260}--profile mini[\s\S]{0,260}--membership-file/i,
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak grant-user[\s\S]{0,260}--profile mini[\s\S]{0,260}--acting-principal/i,
    );
    assert.doesNotMatch(
      doc,
      /deploy admin keycloak grant-user[\s\S]{0,260}--profile mini[\s\S]{0,260}--admin-group/i,
    );
  }
});
