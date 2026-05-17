#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const moduleDir = path.join(
  process.cwd(),
  "projects",
  "deployments",
  "pleomino-infisical",
  "opentofu",
);

async function validateModuleWithProvider() {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pleomino-infisical-tofu-"));
  await fsp.copyFile(path.join(moduleDir, "main.tf"), path.join(workDir, "main.tf"));
  await $({ cwd: workDir })`tofu init -backend=false -input=false`.quiet();
  const validate = await $({ cwd: workDir })`tofu validate -json`.quiet();
  const result = JSON.parse(String(validate.stdout || "{}"));
  assert.equal(result.valid, true);
  assert.equal(result.error_count, 0);
}

test("Pleomino Infisical OpenTofu module stays local, formatted, and non-secret", async () => {
  await $`tofu fmt -check ${moduleDir}`.quiet();
  await validateModuleWithProvider();
  const main = await fsp.readFile(path.join(moduleDir, "main.tf"), "utf8");
  for (const expected of [
    'default = "https://app.infisical.com"',
    'default = "pleomino-deployments"',
    'default = ["staging", "prod"]',
    'default = "cloudflare_api_token"',
    "infisical_identity_universal_auth",
    "cloudflare_secret_metadata_reconciliation",
    "value_wo",
    "deployment_runtime_metadata",
  ]) {
    assert.match(main, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(main, /cloudflare_api_token\s*=\s*["'][^"']+["']/i);
  assert.doesNotMatch(main, /client_secret\s*=\s*["'][^"']+["']/i);
  assert.doesNotMatch(main, /INFISICAL_(?:ACCESS_)?TOKEN/);
});
