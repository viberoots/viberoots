#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sampleInfisicalOpenTofuModule } from "./sample-infisical-opentofu.fixture";

async function withSampleModule<T>(prefix: string, fn: (workDir: string) => Promise<T>) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fsp.writeFile(path.join(workDir, "main.tf"), sampleInfisicalOpenTofuModule(), "utf8");
    return await fn(workDir);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

test("sample Infisical OpenTofu module stays local, formatted, and non-secret", async () => {
  await withSampleModule("sample-infisical-tofu-", async (workDir) => {
    await $({ cwd: workDir })`tofu fmt -check`.quiet();
    await $({ cwd: workDir })`tofu init -backend=false -input=false`.quiet();
    const validate = await $({ cwd: workDir })`tofu validate -json`.quiet();
    const result = JSON.parse(String(validate.stdout || "{}"));
    assert.equal(result.valid, true);
    assert.equal(result.error_count, 0);
    const main = await fsp.readFile(path.join(workDir, "main.tf"), "utf8");
    for (const expected of [
      'source  = "infisical/infisical"',
      'provider "infisical"',
      'default = "https://app.infisical.com"',
      'default = "sample-webapp-deployments"',
      'default = ["staging", "prod"]',
      'default = "cloudflare_api_token"',
      "infisical_identity_universal_auth",
      "cloudflare_secret_metadata_reconciliation",
      "value_wo",
      'output "deployment_runtime_metadata"',
    ]) {
      assert.match(main, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(main, /cloudflare_api_token\s*=\s*["'][^"']+["']/i);
    assert.doesNotMatch(main, /client_secret\s*=\s*["'][^"']+["']/i);
    assert.doesNotMatch(main, /INFISICAL_(?:ACCESS_)?TOKEN/);
  });
});

test("sample Infisical OpenTofu rendered plan emits reviewed site URL", async () => {
  await withSampleModule("sample-infisical-render-", async (workDir) => {
    await fsp.writeFile(
      path.join(workDir, "site-url.tftest.hcl"),
      `
mock_provider "infisical" {}

run "reviewed_site_url" {
  command = plan

  variables {
    organization_id = "org_fixture"
  }

  assert {
    condition     = output.deployment_runtime_metadata["staging"].site_url == "https://app.infisical.com"
    error_message = "staging rendered site URL drifted"
  }

  assert {
    condition     = output.deployment_runtime_metadata["prod"].site_url == "https://app.infisical.com"
    error_message = "prod rendered site URL drifted"
  }
}
`.trimStart(),
    );
    await $({ cwd: workDir })`tofu init -backend=false -input=false`.quiet();
    const rendered = await $({ cwd: workDir })`tofu test -verbose`.quiet();
    const stdout = String(rendered.stdout || "");
    assert.match(stdout, /deployment_runtime_metadata/);
    assert.match(stdout, /site_url\s+= "https:\/\/app\.infisical\.com"/);
    assert.doesNotMatch(stdout, /https:\/\/us\.infisical\.com/);
  });
});
