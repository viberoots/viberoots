#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_SCHEMA } from "../../deployments/deployment-secret-fixture";

const repoRoot = process.cwd();
const secretsUsageDocPath = path.join(repoRoot, "docs", "secrets-usage.md");
const apiDocPath = path.join(repoRoot, "docs", "deployment-secrets-api.md");
const vaultRunbookDocPath = path.join(repoRoot, "docs", "vault-production-bootstrap.md");

async function read(filePath: string): Promise<string> {
  return await fsp.readFile(filePath, "utf8");
}

test("secret fixture docs use the reviewed neutral fixture contract vocabulary", async () => {
  const [secretsUsageDoc, apiDoc, vaultRunbookDoc] = await Promise.all([
    read(secretsUsageDocPath),
    read(apiDocPath),
    read(vaultRunbookDocPath),
  ]);

  for (const doc of [secretsUsageDoc, apiDoc, vaultRunbookDoc]) {
    assert.match(
      doc,
      new RegExp(DEPLOYMENT_SECRET_FIXTURE_SCHEMA),
      "docs must use the reviewed secret fixture schema",
    );
    assert.doesNotMatch(
      doc,
      /deployment-vault-fixture@1/,
      "docs must not mention the retired Vault-named fixture schema",
    );
  }

  assert.match(
    secretsUsageDoc,
    /`secretspec` is the contract layer[\s\S]*admitted secret references[\s\S]*Vault[\s\S]*secret fixture/,
    "secrets usage must explain the contract, admission, Vault, and secret fixture layers together",
  );
  assert.match(
    apiDoc,
    /Secret Fixture Example/,
    "deployment and secrets API doc must present the fixture example as a secret fixture",
  );
  assert.match(
    vaultRunbookDoc,
    /exported secret fixture/i,
    "Vault bootstrap runbook must describe the exported file as a secret fixture",
  );
});
