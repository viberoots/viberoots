#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";
import { renderReport, summarize } from "../../deployments/sprinkleref-check-report";
import type { SprinkleRefCheckEntry } from "../../deployments/sprinkleref-check-types";
import { runInTemp } from "../lib/test-helpers";

test("human check output groups missing refs by Infisical context", () => {
  const missing = entry("secret://deployments/demo/api_token");
  const text = renderReport({
    scannedFiles: 1,
    refs: [missing],
    summary: summarize([missing]),
  });
  assert.match(text, /Missing values:/);
  assert.match(text, /category: main \(infisical\)\n\s+project: proj_123\n\s+environment: staging/);
  assert.match(text, /secret:\/\/deployments\/demo\/api_token/);
  assert.doesNotMatch(text, /missing secret:\/\/deployments\/demo\/api_token/);
});

test("human check output groups deployment environments for the same missing ref", () => {
  const refs = [
    {
      ...entry("secret://deployments/pleomino/cloudflare_api_token"),
      backend: "infisical project proj_123 (pleomino-deployments) environment staging",
      deploymentFamily: "pleomino",
      requiredBy: ["//projects/deployments/pleomino-staging:deploy"],
    },
    {
      ...entry("secret://deployments/pleomino/cloudflare_api_token"),
      backend: "infisical project proj_123 (pleomino-deployments) environment prod",
      deploymentFamily: "pleomino",
      requiredBy: ["//projects/deployments/pleomino-prod:deploy"],
    },
  ];
  const text = renderReport({ scannedFiles: 1, refs, summary: summarize(refs) });
  assert.match(text, /family: pleomino/);
  assert.match(text, /project: pleomino-deployments \(proj_123\)/);
  assert.match(text, /environment: prod, staging/);
  assert.equal(text.match(/secret:\/\/deployments\/pleomino\/cloudflare_api_token/g)?.length, 1);
  assert.doesNotMatch(text, /source secret_requirements/);
  assert.match(
    text,
    /required by:\n\s+\/\/projects\/deployments\/pleomino-staging:deploy\n\s+\/\/projects\/deployments\/pleomino-prod:deploy/,
  );
});

test("human check output points unchecked secrets at interactive repo bootstrap", () => {
  const unchecked = {
    ...entry("secret://deployments/demo/api_token"),
    status: "unchecked" as const,
  };
  const text = renderReport({
    scannedFiles: 1,
    refs: [unchecked],
    summary: summarize([unchecked]),
  });
  assert.match(text, /Unchecked secrets: 1/);
  assert.match(text, /infisical-bootstrap\.ts repo --dry-run/);
  assert.match(text, /infisical-bootstrap\.ts repo, or sprinkleref --init sprinkleref/);
  assert.doesNotMatch(text, /infisical-bootstrap\.ts repo --yes/);
});

test("check report shows inferred deployment family for missing target refs", async () => {
  await runInTemp("sprinkleref-report-inferred-family", async (tmp) => {
    await writeReportTarget(path.join(tmp, "projects/deployments/report-demo/staging"), {
      ref: "secret://deployments/report-demo/api_token",
      stage: "staging",
    });
    const text = await runCheck(tmp, "//projects/deployments/report-demo/staging:deploy");
    assert.match(text, /Missing values:[\s\S]*family: report-demo/);
    assert.match(text, /secret:\/\/deployments\/report-demo\/api_token/);
  });
});

test("check report shows explicit override family for missing target refs", async () => {
  await runInTemp("sprinkleref-report-explicit-family", async (tmp) => {
    await writeReportTarget(path.join(tmp, "projects/deployments/report-demo/prod"), {
      deploymentFamily: "override-family",
      ref: "secret://deployments/report-demo/api_token",
      stage: "prod",
    });
    const text = await runCheck(tmp, "//projects/deployments/report-demo/prod:deploy");
    assert.match(text, /Missing values:[\s\S]*family: override-family/);
    assert.doesNotMatch(text, /family: report-demo/);
  });
});

function entry(ref: string): SprinkleRefCheckEntry {
  return {
    ref,
    scheme: "secret",
    sensitive: true,
    status: "missing",
    scope: "repo",
    locations: ["TARGETS:1"],
    requiredBy: [],
    category: "main",
    backend: "infisical project proj_123 environment staging",
  };
}

async function runCheck(tmp: string, target: string): Promise<string> {
  const config = path.join(tmp, "resolver.json");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: path.join(tmp, "store.json") } },
    })}\n`,
  );
  let output = "";
  const exitCode = await runInDir(tmp, () =>
    runSprinkleRefCheck({
      argv: ["--check", "--target", target, "--no-deps", "--config", config],
      stdout: (text) => (output = text),
    }),
  );
  assert.equal(exitCode, 1);
  return output;
}

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}

async function writeReportTarget(
  dir: string,
  opts: { deploymentFamily?: string; ref: string; stage: string },
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
      "    secret_requirements = [",
      `        {"name": "api_token", "step": "publish", "contract_id": "${opts.ref}", "required": "true"},`,
      "    ],",
      ")",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
