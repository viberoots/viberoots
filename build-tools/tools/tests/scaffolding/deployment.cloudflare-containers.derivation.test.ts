#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const accountId = "0123456789abcdef0123456789abcdef";

type Expected = {
  name: string;
  className: string;
  bindingName: string;
  migrationTag: string;
  workerPath: string;
};

const cases: Expected[] = [
  {
    name: "api-staging",
    className: "ApiStagingContainer",
    bindingName: "API_STAGING_CONTAINER",
    migrationTag: "api-staging-containers-v1",
    workerPath: "src/api-staging-worker.ts",
  },
  {
    name: "api_2",
    className: "Api2Container",
    bindingName: "API_2_CONTAINER",
    migrationTag: "api_2-containers-v1",
    workerPath: "src/api_2-worker.ts",
  },
  {
    name: "7Mixed_Name",
    className: "Deployment7MixedNameContainer",
    bindingName: "DEPLOYMENT_7MIXED_NAME_CONTAINER",
    migrationTag: "7Mixed_Name-containers-v1",
    workerPath: "src/7Mixed_Name-worker.ts",
  },
  {
    name: "Mixed-Case_9",
    className: "MixedCase9Container",
    bindingName: "MIXED_CASE_9_CONTAINER",
    migrationTag: "Mixed-Case_9-containers-v1",
    workerPath: "src/Mixed-Case_9-worker.ts",
  },
];

function assertNoStaleHardcodedNames(text: string): void {
  assert.doesNotMatch(text, /ContainerEntrypoint/);
  assert.doesNotMatch(text, /\bCONTAINER\b/);
  assert.doesNotMatch(text, /src\/worker\.ts/);
}

async function assertDerivedNames(tmp: string, expected: Expected): Promise<void> {
  const root = path.join(tmp, "projects/deployments", expected.name);
  const wrangler = await fsp.readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const worker = await fsp.readFile(path.join(root, expected.workerPath), "utf8");
  assert.match(wrangler, new RegExp(`"main": "${expected.workerPath}"`));
  assert.match(wrangler, new RegExp(`"name": "${expected.bindingName}"`));
  assert.match(wrangler, new RegExp(`"class_name": "${expected.className}"`));
  assert.match(wrangler, new RegExp(`"tag": "${expected.migrationTag}"`));
  assert.match(worker, new RegExp(`class ${expected.className}`));
  assert.match(worker, new RegExp(`${expected.bindingName}: DurableObjectNamespace`));
  assert.match(worker, new RegExp(`getContainer\\(env\\.${expected.bindingName}\\)`));
  assertNoStaleHardcodedNames(wrangler);
  assertNoStaleHardcodedNames(worker);
}

test("deployment/cloudflare-containers derives Cloudflare implementation names from deployment name", async () => {
  await runInTemp("deployment-cloudflare-containers-derivation", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    for (const item of cases) {
      await $`scaf new deployment cloudflare-containers ${item.name} --component=//projects/apps/api:service_artifact --cloudflare_account_id=${accountId} --worker=${item.name} --yes`;
      await assertDerivedNames(tmp, item);
    }
    assert.equal(new Set(cases.map((item) => item.className)).size, cases.length);
    assert.equal(new Set(cases.map((item) => item.bindingName)).size, cases.length);
    assert.equal(new Set(cases.map((item) => item.migrationTag)).size, cases.length);
    assert.equal(new Set(cases.map((item) => item.workerPath)).size, cases.length);
  });
});
