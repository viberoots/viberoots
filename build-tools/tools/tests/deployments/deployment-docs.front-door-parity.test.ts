#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const designDocPath = path.join(repoRoot, "docs", "deployments-design.md");
const scenariosDocPath = path.join(repoRoot, "docs", "deployment-scenarios.md");
const contractDocPath = path.join(repoRoot, "docs", "deployments-contract.md");
const defsPath = path.join(repoRoot, "build-tools", "deployments", "defs.bzl");

const bannedDocFragments = [
  "deploy <deployment-id>",
  '`deployment(name = "deploy", ...)`',
  "`deployment(...)`",
  "cloudflare_static_pwa_deployment(",
  "single_component_deployment(",
  'load("//build-tools/deploy:',
  "//build-tools/deploy/",
] as const;

async function read(filePath: string): Promise<string> {
  return await fsp.readFile(filePath, "utf8");
}

function assertBannedFragmentsAbsent(doc: string, label: string) {
  for (const fragment of bannedDocFragments) {
    assert.ok(!doc.includes(fragment), `${label} must not contain stale fragment: ${fragment}`);
  }
}

test("deployment design and scenario docs stay aligned with the reviewed front door and authoring surface", async () => {
  const [designDoc, scenariosDoc, contractDoc, defs] = await Promise.all([
    read(designDocPath),
    read(scenariosDocPath),
    read(contractDocPath),
    read(defsPath),
  ]);

  assertBannedFragmentsAbsent(designDoc, "deployment design");
  assertBannedFragmentsAbsent(scenariosDoc, "deployment scenarios");
  assertBannedFragmentsAbsent(contractDoc, "deployment contract");

  assert.match(
    designDoc,
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    "deployment design must document the reviewed --deployment <label> front door",
  );
  assert.match(
    scenariosDoc,
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    "deployment scenarios must use the reviewed --deployment <label> front door",
  );
  assert.match(
    designDoc,
    /cloudflare_pages_static_webapp_deployment\(/,
    "deployment design must show the reviewed Cloudflare Pages authoring helper",
  );
  assert.match(
    designDoc,
    /deployment_target\(/,
    "deployment design must show the reviewed low-level deployment_target rule",
  );
  for (const symbol of [
    "deployment_target",
    "cloudflare_pages_static_webapp_deployment",
    "nixos_shared_host_static_webapp_deployment",
    "nixos_shared_host_ssr_webapp_deployment",
    "nixos_shared_host_multi_static_webapp_deployment",
    "s3_static_webapp_deployment",
  ]) {
    assert.match(defs, new RegExp(`\\b${symbol}\\b`), `defs.bzl must export ${symbol}`);
  }
});
