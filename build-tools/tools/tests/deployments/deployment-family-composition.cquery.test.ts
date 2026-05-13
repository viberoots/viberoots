#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseJsoncObject } from "../../deployments/cloudflare-pages-config";
import { validateOpenTofuStackConfigFacts } from "../../deployments/opentofu-stack";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureParentDir,
  runDeploymentCquery,
  writeSharedLaneTargets,
  writeStaticWebappTarget,
} from "./nixos-shared-host.extraction.from-targets.helpers";

function nodeByName(nodes: any[], name: string): any {
  const found = nodes.find((node) => node.name === name);
  assert.ok(found, `expected ${name}`);
  return found;
}

function platformFoundationStack(stage: string): string {
  return ["phase", "0/platform-foundation/", stage].join("");
}

async function readJsonObject(filePath: string): Promise<Record<string, string>> {
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, string>;
}

async function assertWranglerStaysBelowBuckMetadata(packagePath: string, node: any) {
  const configPath = path.join(process.cwd(), packagePath, String(node.publisher_config));
  const parsed = parseJsoncObject(await fsp.readFile(configPath, "utf8"), configPath);
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.account_id, undefined);
  assert.ok(node.provider_target.project);
  assert.ok(node.provider_target.account);
}

async function assertOpenTofuStackMatchesBuckMetadata(packagePath: string, node: any) {
  const configPath = path.join(process.cwd(), packagePath, String(node.provisioner_config));
  const parsed = await readJsonObject(configPath);
  validateOpenTofuStackConfigFacts({
    configPath,
    config: parsed,
    stackIdentity: String(node.provider_target.stack_identity),
    stateBackendIdentity: String(node.provider_target.state_backend_identity),
  });
  assert.equal(parsed.stack_identity, node.provider_target.stack_identity);
  assert.equal(parsed.state_backend_identity, node.provider_target.state_backend_identity);
}

async function writeFamilyDriftFixture(tmp: string, body: string): Promise<void> {
  await writeStaticWebappTarget(path.join(tmp, "projects/apps/demo/TARGETS"), "app");
  await writeSharedLaneTargets(path.join(tmp, "projects/deployments/demo-shared/TARGETS"));
  const deployTargetsPath = path.join(tmp, "projects/deployments/demo-dev/TARGETS");
  await ensureParentDir(deployTargetsPath);
  await fsp.writeFile(deployTargetsPath, body, "utf8");
}

async function expectBuckFailure(tmp: string, $: any, pattern: RegExp): Promise<void> {
  const result = await $({
    cwd: tmp,
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 cquery --target-platforms prelude//platforms:default //projects/deployments/demo-dev:deploy`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(`${String(result.stdout || "")}\n${String(result.stderr || "")}`, pattern);
}

test("concrete deployment families compose defaults into explicit stage targets", async () => {
  const nodes = await runDeploymentCquery(process.cwd(), $, "deployment-family-real-cquery", [
    "//projects/deployments/pleomino-staging:deploy",
    "//projects/deployments/pleomino-dev:deploy",
    "//projects/deployments/pleomino-prod:deploy",
    "//projects/deployments/platform-foundation-dev:deploy",
    "//projects/deployments/platform-foundation-staging:deploy",
    "//projects/deployments/platform-foundation-prod:deploy",
    "//projects/apps/pleomino:app",
    "//projects/deployments/pleomino-shared:lane",
    "//projects/deployments/pleomino-shared:dev_release",
    "//projects/deployments/pleomino-shared:staging_release",
    "//projects/deployments/pleomino-shared:prod_release",
    "//projects/deployments/platform-shared:lane",
    "//projects/deployments/platform-shared:dev_release",
    "//projects/deployments/platform-shared:staging_release",
    "//projects/deployments/platform-shared:prod_release",
    "//projects/deployments/platform-shared:migration_bundle",
  ]);
  const dev = nodeByName(nodes, "//projects/deployments/pleomino-dev:deploy");
  const staging = nodeByName(nodes, "//projects/deployments/pleomino-staging:deploy");
  const prod = nodeByName(nodes, "//projects/deployments/pleomino-prod:deploy");
  const platformDev = nodeByName(nodes, "//projects/deployments/platform-foundation-dev:deploy");
  const platformStaging = nodeByName(
    nodes,
    "//projects/deployments/platform-foundation-staging:deploy",
  );
  const platformProd = nodeByName(nodes, "//projects/deployments/platform-foundation-prod:deploy");
  assert.equal(dev.provider_target.app_name, "pleomino");
  assert.equal(dev.provider_target.target_group, "default");
  assert.equal(
    dev.provider_target.deployment_target_identity,
    "nixos-shared-host:default:pleomino",
  );
  assert.match(String(staging.component), /\/\/projects\/apps\/pleomino:app/);
  assert.match(String(staging.lane_policy), /\/\/projects\/deployments\/pleomino-shared:lane/);
  assert.equal(staging.provider_target.project, "pleomino-staging-pages");
  assert.deepEqual(staging.ingress_hostnames, ["staging.pleomino.com"]);
  assert.equal(prod.provider_target.project, "pleomino-prod-pages");
  assert.equal(prod.protection_class, "production_facing");
  assert.equal(platformDev.provider_target.stack_identity, platformFoundationStack("dev"));
  assert.equal(platformProd.provider_target.stack_identity, platformFoundationStack("prod"));
  assert.deepEqual(platformProd.resource_sizing, { profile: "phase0-foundation-baseline" });
  assert.match(
    String(platformProd.migration_bundle),
    /\/\/projects\/deployments\/platform-shared:migration_bundle/,
  );
  assert.deepEqual(platformProd.prerequisites, [
    { deployment_id: "platform-foundation-staging", mode: "ordering_only" },
  ]);
  await assertWranglerStaysBelowBuckMetadata("projects/deployments/pleomino-staging", staging);
  await assertWranglerStaysBelowBuckMetadata("projects/deployments/pleomino-prod", prod);
  await assertOpenTofuStackMatchesBuckMetadata(
    "projects/deployments/platform-foundation-dev",
    platformDev,
  );
  await assertOpenTofuStackMatchesBuckMetadata(
    "projects/deployments/platform-foundation-staging",
    platformStaging,
  );
  await assertOpenTofuStackMatchesBuckMetadata(
    "projects/deployments/platform-foundation-prod",
    platformProd,
  );
});

test("OpenTofu stack config fact validation rejects provider-native drift", () => {
  assert.throws(
    () =>
      validateOpenTofuStackConfigFacts({
        configPath: "projects/deployments/platform-foundation-prod/opentofu/stack.json",
        config: {
          stack_identity: "foundation/shared/staging",
          state_backend_identity: "s3://state/prod/platform-foundation",
        },
        stackIdentity: "foundation/shared/prod",
        stateBackendIdentity: "s3://state/prod/platform-foundation",
      }),
    /stack_identity foundation\/shared\/staging does not match deployment provider_target\.stack_identity foundation\/shared\/prod/,
  );
});

test("deployment family composition rejects provider args that drift family defaults", async () => {
  await runInTemp("deployment-family-default-drift", async (tmp, $) => {
    await writeFamilyDriftFixture(
      tmp,
      [
        'load("//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
        'load("//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")',
        "nixos_shared_host_static_webapp_deployment(**compose_deployment_family_kwargs(",
        '    deployment_family_defaults(component = "//projects/apps/demo:app", lane_policy = "//projects/deployments/demo-shared:lane"),',
        '    deployment_stage_delta(stage = "dev", admission_policy = "//projects/deployments/demo-shared:dev_release", protection_class = "shared_nonprod"),',
        '    provider_args = {"name": "deploy", "component": "//projects/apps/demo:other", "app_name": "demo", "container_port": 3000},',
        "))",
        "",
      ].join("\n"),
    );
    await expectBuckFailure(
      tmp,
      $,
      /provider_args must not set component; it comes from family defaults/,
    );
  });
});

test("deployment family composition rejects provider args that drift explicit provider target", async () => {
  await runInTemp("deployment-family-provider-target-drift", async (tmp, $) => {
    await writeFamilyDriftFixture(
      tmp,
      [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
        'load("//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")',
        "cloudflare_pages_static_webapp_deployment(**compose_deployment_family_kwargs(",
        '    deployment_family_defaults(component = "//projects/apps/demo:app", lane_policy = "//projects/deployments/demo-shared:lane"),',
        "    deployment_stage_delta(",
        '        stage = "dev", admission_policy = "//projects/deployments/demo-shared:dev_release", protection_class = "shared_nonprod",',
        '        provider_target = {"account": "web-platform", "project": "demo-dev-pages"},',
        "    ),",
        '    provider_args = {"name": "deploy", "account": "web-platform", "project": "demo-prod-pages"},',
        "    include_provider_target = False,",
        "))",
        "",
      ].join("\n"),
    );
    await expectBuckFailure(
      tmp,
      $,
      /provider_args project demo-prod-pages contradicts stage provider_target\.project demo-dev-pages/,
    );
  });
});

test("deployment family composition rejects provider-native facts that contradict Buck metadata", async () => {
  await runInTemp("deployment-family-provider-native-drift", async (tmp, $) => {
    await writeFamilyDriftFixture(
      tmp,
      [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
        'load("//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")',
        "cloudflare_pages_static_webapp_deployment(**compose_deployment_family_kwargs(",
        '    deployment_family_defaults(component = "//projects/apps/demo:app", lane_policy = "//projects/deployments/demo-shared:lane"),',
        "    deployment_stage_delta(",
        '        stage = "dev", admission_policy = "//projects/deployments/demo-shared:dev_release", protection_class = "shared_nonprod",',
        '        provider_target = {"account": "web-platform", "project": "demo-dev-pages"},',
        '        provider_native_facts = {"provider_target.project": "demo-prod-pages"},',
        "    ),",
        '    provider_args = {"name": "deploy", "account": "web-platform", "project": "demo-dev-pages"},',
        "    include_provider_target = False,",
        "))",
        "",
      ].join("\n"),
    );
    await expectBuckFailure(
      tmp,
      $,
      /provider-native provider_target\.project demo-prod-pages contradicts Buck metadata demo-dev-pages/,
    );
  });
});
