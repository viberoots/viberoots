#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("Vault bootstrap runbook uses reviewed mini IdP module and JWT helper", async () => {
  const doc = await fsp.readFile(
    path.join(process.cwd(), "docs", "vault-production-bootstrap.md"),
    "utf8",
  );
  assert.match(doc, /mini-identity-provider-module\.nix/);
  assert.match(doc, /bucknix\.mini\.identityProvider/);
  assert.match(doc, /deploy-vault-jwt \\/);
  assert.match(doc, /--client-secret-env BNX_DEPLOYER_CLIENT_SECRET/);
  assert.match(doc, /--expect-claim deployment_environment=mini/);
  assert.doesNotMatch(doc, /protocol\/openid-connect\/token" \\/);
  assert.doesNotMatch(doc, /client_secret=\$BNX_DEPLOYER_CLIENT_SECRET/);
  assert.doesNotMatch(doc, /initialAdminPassword = "replace-after-first-login"/);
});
