#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractDeployments } from "../../deployments/contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const accountId = "0123456789abcdef0123456789abcdef";

async function writeDefaults(tmp: string): Promise<void> {
  await fsp.writeFile(
    path.join(tmp, "projects/deployments/TARGETS"),
    'load("//build-tools/deployments:defs.bzl", "deployment_defaults")\ndeployment_defaults(name = "defaults", visibility = ["PUBLIC"])\n',
    "utf8",
  );
}

async function writeServiceApp(tmp: string): Promise<void> {
  const appDir = path.join(tmp, "projects/apps/api");
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.writeFile(
    path.join(appDir, "TARGETS"),
    'load("@prelude//:rules.bzl", "genrule")\ngenrule(name = "service_artifact", out = "image.txt", cmd = "echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > $OUT", labels = ["kind:app", "kind:service"], visibility = ["PUBLIC"])\n',
    "utf8",
  );
}

test("deployment/cloudflare-containers scaffold renders Worker config and metadata", async () => {
  await runInTemp("deployment-cloudflare-containers-scaffold", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new deployment shared demo --repository=example/platform --yes`;
    await $`scaf new deployment cloudflare-containers api-staging --component=//projects/apps/api:service_artifact --cloudflare_account_id=${accountId} --worker=api-staging --domain=api.example.com --cloudflare_zone_id=${accountId} --sleep_after=20m --max_instances=3 --shared_package=demo-shared --yes`;
    await writeDefaults(tmp);
    await writeServiceApp(tmp);
    const deploymentRoot = path.join(tmp, "projects/deployments/api-staging");
    const targetsPath = path.join(deploymentRoot, "TARGETS");
    const wranglerPath = path.join(deploymentRoot, "wrangler.jsonc");
    const workerPath = path.join(deploymentRoot, "src/worker.ts");
    const wrangler = await fsp.readFile(wranglerPath, "utf8");
    assert.match(wrangler, /"name": "api-staging"/);
    assert.match(wrangler, /"custom_domain": true/);
    assert.match(wrangler, /"max_instances": 3/);
    assert.match(wrangler, /"sleep_after": "20m"/);
    assert.doesNotMatch(wrangler, /example\/platform/);
    assert.doesNotMatch(wrangler, /\/\/projects\/apps\/api:service_artifact/);
    assert.doesNotMatch(wrangler, /component_kind/);
    assert.doesNotMatch(wrangler, /demo-shared/);
    assert.doesNotMatch(wrangler, /lane_policy|admission_policy|dev_release/);
    assert.doesNotMatch(wrangler, /secret_requirements|runtime_config_requirements/);
    assert.doesNotMatch(wrangler, /cloudflare_api_token|cloudflare_registry_token/);
    assert.doesNotMatch(wrangler, /external_requirement_profiles|cloudflare_provider/);
    assert.doesNotMatch(wrangler, /protection_class|shared_nonprod/);
    assert.match(await fsp.readFile(workerPath, "utf8"), /getContainer/);
    const targets = await fsp.readFile(targetsPath, "utf8");
    assert.match(targets, /cloudflare_containers_deployment/);
    assert.match(targets, /sleep_after = "20m"/);
    assert.match(targets, /max_instances = "3"/);
    assert.match(targets, /external_requirement_profiles = \["cloudflare_provider"\]/);
    await $`nix shell nixpkgs#buildifier -c buildifier --mode=check ${targetsPath}`;
    assert.equal(
      targets,
      `load("//build-tools/deployments:defs.bzl", "cloudflare_containers_deployment")

cloudflare_containers_deployment(
    name = "deploy",
    component = "//projects/apps/api:service_artifact",
    component_kind = "service",
    cloudflare_account_id = "${accountId}",
    worker = "api-staging",
    ingress_mode = "public",
    domain = "api.example.com",
    cloudflare_zone_id = "${accountId}",
    container_port = 8080,
    health_path = "/healthz",
    workers_dev_exception = False,
    sleep_after = "20m",
    max_instances = "3",
    lane_policy = "//projects/deployments/demo-shared:lane",
    environment_stage = "dev",
    admission_policy = "//projects/deployments/demo-shared:dev_release",
    protection_class = "shared_nonprod",
    secret_requirements = [
        {
            "name": "cloudflare_api_token",
            "step": "provision",
            "contract_id": "secret://deployments/api-staging/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_api_token",
            "step": "publish",
            "contract_id": "secret://deployments/api-staging/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_api_token",
            "step": "preview_cleanup",
            "contract_id": "secret://deployments/api-staging/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_registry_token",
            "step": "publish",
            "contract_id": "secret://deployments/api-staging/cloudflare_registry_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [],
    external_requirement_profiles = ["cloudflare_provider"],
)
`,
    );
    await $`pnpm prettier --check ${wranglerPath} ${workerPath}`;
    const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/api-staging:deploy //projects/apps/api:service_artifact //projects/deployments:defaults //projects/deployments/demo-shared:lane_governance //projects/deployments/demo-shared:lane //projects/deployments/demo-shared:dev_release)";
    const cquery = await $({
      env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-cloudflare-containers-scaffold")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
    const { deployments, errors } = extractDeployments(
      nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}"))),
    );
    assert.deepEqual(errors, []);
    assert.equal(deployments[0]?.provider, "cloudflare-containers");
    assert.equal((deployments[0]?.providerTarget as any).domain, "api.example.com");
    assert.equal((deployments[0]?.providerTarget as any).sleepAfter, "20m");
    assert.equal((deployments[0]?.providerTarget as any).maxInstances, "3");
  });
});

test("deployment/cloudflare-containers requires provider identity answers", async () => {
  await runInTemp("deployment-cloudflare-containers-required-flags", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    const result =
      await $`scaf new deployment cloudflare-containers missing --component=//projects/apps/api:service_artifact --yes`.nothrow();
    assert.notEqual((result as any).exitCode, 0);
    assert.match(String((result as any).stderr || ""), /--cloudflare_account_id, --worker/);
  });
});

test("deployment/cloudflare-containers private and no-ingress configs do not expose routes", async () => {
  await runInTemp("deployment-cloudflare-containers-no-routes", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new deployment cloudflare-containers api-private --component=//projects/apps/api:service_artifact --cloudflare_account_id=${accountId} --worker=api-private --ingress_mode=private --yes`;
    await $`scaf new deployment cloudflare-containers worker-none --component=//projects/apps/worker:service_artifact --cloudflare_account_id=${accountId} --worker=worker-none --ingress_mode=none --component_kind=third-party-service --yes`;
    const privateWrangler = await fsp.readFile(
      path.join(tmp, "projects/deployments/api-private/wrangler.jsonc"),
      "utf8",
    );
    const noneWrangler = await fsp.readFile(
      path.join(tmp, "projects/deployments/worker-none/wrangler.jsonc"),
      "utf8",
    );
    assert.doesNotMatch(privateWrangler, /"routes"/);
    assert.doesNotMatch(privateWrangler, /"custom_domain"/);
    assert.doesNotMatch(noneWrangler, /"routes"/);
    assert.doesNotMatch(noneWrangler, /"custom_domain"/);
  });
});
