#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("Pleomino family metadata is exported for staged deployments", async () => {
  const labels = [
    "//projects/deployments/pleomino-staging:deploy",
    "//projects/deployments/pleomino-prod:deploy",
    "//projects/apps/pleomino:app",
    "//projects/deployments/pleomino-shared:lane",
    "//projects/deployments:defaults",
    "//projects/deployments/pleomino-shared:lane_governance",
    "//projects/deployments/pleomino-shared:staging_release",
    "//projects/deployments/pleomino-shared:prod_release",
  ];
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const result = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-family-metadata")} cquery --target-platforms prelude//platforms:default ${`set(${labels.join(" ")})`} --json ${attrFlags}`.quiet();
  const nodes = nodesFromCqueryJson(JSON.parse(String(result.stdout || "{}")));
  const extracted = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(extracted.errors, []);
  assert.deepEqual(
    extracted.deployments.map((deployment) => [
      deployment.label,
      deployment.deploymentFamily,
      deployment.environmentStage,
    ]),
    [
      ["//projects/deployments/pleomino-prod:deploy", "pleomino", "prod"],
      ["//projects/deployments/pleomino-staging:deploy", "pleomino", "staging"],
    ],
  );
});

test("deployment family is inferred only from canonical family directories", async () => {
  await runInTemp("deployment-family-directory-inference", async (tmp) => {
    await writeInferenceFixture(tmp);
    const metadata = await queryDeploymentMetadata(tmp, [
      "//projects/deployments/demo/staging:deploy",
      "//projects/deployments/demo/prod:deploy",
      "//projects/deployments/demo-prod:deploy",
    ]);
    assert.deepEqual(metadata, [
      ["//projects/deployments/demo-prod:deploy", "", "prod"],
      ["//projects/deployments/demo/prod:deploy", "override-demo", "prod"],
      ["//projects/deployments/demo/staging:deploy", "demo", "staging"],
    ]);
  });
});

async function queryDeploymentMetadata(cwd: string, labels: string[]) {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const result = await $({
    cwd,
    stdio: "pipe",
    env: buckEnv(),
  })`buck2 cquery --target-platforms prelude//platforms:default ${`set(${labels.join(" ")})`} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(result.stdout || "{}")))
    .map((node) => [
      String(node.name || ""),
      String(node.deployment_family || ""),
      String(node.environment_stage || ""),
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

async function writeInferenceFixture(tmp: string): Promise<void> {
  await writeDeploymentTarget(path.join(tmp, "projects/deployments/demo/staging"), {
    stage: "staging",
  });
  await writeDeploymentTarget(path.join(tmp, "projects/deployments/demo/prod"), {
    deploymentFamily: "override-demo",
    stage: "prod",
  });
  await writeDeploymentTarget(path.join(tmp, "projects/deployments/demo-prod"), {
    stage: "prod",
  });
}

async function writeDeploymentTarget(
  dir: string,
  opts: { deploymentFamily?: string; stage: string },
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const familyLine = opts.deploymentFamily
    ? `    deployment_family = "${opts.deploymentFamily}",`
    : "";
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT")',
      "deployment_target(",
      '    name = "deploy",',
      '    provider = "test",',
      '    component = ":app",',
      '    component_kind = "test",',
      '    publisher = "test",',
      familyLine,
      `    environment_stage = "${opts.stage}",`,
      ")",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}
