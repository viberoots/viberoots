#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractDeployments } from "../../deployments/contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

async function writeDefaults(tmp: string): Promise<void> {
  await fsp.writeFile(
    path.join(tmp, "projects/deployments/TARGETS"),
    'load("//build-tools/deployments:defs.bzl", "deployment_defaults")\ndeployment_defaults(name = "defaults", visibility = ["PUBLIC"])\n',
    "utf8",
  );
}

async function writeStaticApp(tmp: string): Promise<void> {
  const appDir = path.join(tmp, "projects/apps/demo");
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.writeFile(
    path.join(appDir, "TARGETS"),
    'load("@prelude//:rules.bzl", "genrule")\ngenrule(name = "app", out = "app.txt", cmd = "echo demo > $OUT", labels = ["kind:app", "webapp:static"], visibility = ["PUBLIC"])\n',
    "utf8",
  );
}

async function scaffoldCloudflarePages(tmp: string, $: any): Promise<void> {
  await $`scaf new deployment shared demo --repository=example/platform --yes`;
  await $`scaf new deployment cloudflare-pages demo-pages --component=//projects/apps/demo:app --account=web-platform-staging --project=demo-pages --shared_package=demo-shared --yes`;
  await writeDefaults(tmp);
  await writeStaticApp(tmp);
}

test("deployment/cloudflare-pages scaffold renders provider config and metadata", async () => {
  await runInTemp("deployment-cloudflare-pages-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await scaffoldCloudflarePages(tmp, $);

    const deploymentRoot = path.join(tmp, "projects/deployments/demo-pages");
    assert.equal(
      await fsp.readFile(path.join(deploymentRoot, "wrangler.jsonc"), "utf8"),
      '{\n  "$schema": "../../../node_modules/wrangler/config-schema.json",\n  "compatibility_date": "2026-03-18",\n}\n',
    );
    const targets = await fsp.readFile(path.join(deploymentRoot, "TARGETS"), "utf8");
    assert.match(targets, /cloudflare_pages_static_webapp_deployment/);
    assert.match(targets, /external_requirement_profiles = \["cloudflare_provider"\]/);
    assert.doesNotMatch(targets, /account_id =|custom_domain =|smoke =/);

    const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/demo-pages:deploy //projects/apps/demo:app //projects/deployments:defaults //projects/deployments/demo-shared:lane_governance //projects/deployments/demo-shared:lane //projects/deployments/demo-shared:dev_release)";
    const cquery = await $({
      env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-cloudflare-pages-scaffold")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
    const { deployments, errors } = extractDeployments(
      nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}"))),
    );
    assert.deepEqual(errors, []);
    assert.equal(deployments[0]?.provider, "cloudflare-pages");
    assert.deepEqual(deployments[0]?.externalRequirementProfiles, ["cloudflare_provider"]);
    assert.deepEqual(
      deployments[0]?.secretRequirements.map(({ name, step, contractId }) => ({
        name,
        step,
        contractId,
      })),
      [
        {
          name: "cloudflare_api_token",
          step: "provision",
          contractId: "secret://deployments/demo-pages/cloudflare_api_token",
        },
        {
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/demo-pages/cloudflare_api_token",
        },
        {
          name: "cloudflare_api_token",
          step: "preview_cleanup",
          contractId: "secret://deployments/demo-pages/cloudflare_api_token",
        },
      ],
    );
  });
});

test("deployment/cloudflare-pages requires provider identity answers", async () => {
  await runInTemp("deployment-cloudflare-pages-required-flags", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    const result =
      await $`scaf new deployment cloudflare-pages missing --component=//projects/apps/demo:app --yes`.nothrow();
    assert.notEqual((result as any).exitCode, 0);
    assert.match(String((result as any).stderr || ""), /--account, --project/);
  });
});

test("generated cloudflare-pages deployment fails validate-only on wrangler config defects", async (t) => {
  await runInTemp("deployment-cloudflare-pages-config-validation", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await scaffoldCloudflarePages(tmp, $);
    const deployment = "//projects/deployments/demo-pages:deploy";
    const wranglerPath = path.join(tmp, "projects/deployments/demo-pages/wrangler.jsonc");

    await t.test("missing wrangler.jsonc", async () => {
      await fsp.rm(wranglerPath);
      await assert.rejects(
        async () =>
          await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment} --validate-only`,
        /cloudflare-pages provider config not found.*wrangler\.jsonc/,
      );
    });

    await t.test("malformed wrangler.jsonc", async () => {
      await fsp.writeFile(wranglerPath, '{ "compatibility_date": ', "utf8");
      await assert.rejects(
        async () =>
          await $`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment} --validate-only`,
        /invalid wrangler config/,
      );
    });
  });
});
