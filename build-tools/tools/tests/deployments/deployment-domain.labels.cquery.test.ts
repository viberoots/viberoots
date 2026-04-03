#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEPLOYMENT_DOMAIN_LABEL,
  REVIEWED_DEPLOYMENT_TEST_AREA,
} from "../../lib/deployment-verify-scope.ts";
import { normalizeTargetLabel } from "../../lib/labels.ts";
import { inheritedBuckIsolation } from "../lib/test-helpers.ts";

function autoZxTargetForScript(scriptPath: string): string {
  let name = scriptPath;
  if (name.startsWith("build-tools/tools/tests/")) {
    name = name.slice("build-tools/tools/tests/".length);
  }
  if (name.endsWith(".ts")) {
    name = name.slice(0, -".ts".length);
  }
  if (name.endsWith(".test")) {
    name = name.slice(0, -".test".length);
  }
  return `//:${name.replace(/[/.-]/g, "_")}`;
}

function parseCqueryTargets(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as Record<string, { name?: string }>;
  return Object.keys(parsed).map(normalizeTargetLabel).sort();
}

function parseCqueryLabels(stdout: string): Map<string, string[]> {
  const parsed = JSON.parse(stdout) as Record<string, { labels?: string[] }>;
  return new Map(
    Object.entries(parsed).map(([target, attrs]) => [
      normalizeTargetLabel(target),
      Array.isArray(attrs?.labels) ? attrs.labels.map(String) : [],
    ]),
  );
}

async function deploymentTestScripts(root: string): Promise<string[]> {
  const dir = path.join(root, REVIEWED_DEPLOYMENT_TEST_AREA);
  const entries = await fsp.readdir(dir);
  return entries
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => path.posix.join(REVIEWED_DEPLOYMENT_TEST_AREA, entry))
    .sort();
}

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

test("deployment-domain label cquery resolves the reviewed deployment test suite", async () => {
  const root = process.cwd();
  const expected = (await deploymentTestScripts(root)).map(autoZxTargetForScript).sort();
  const query = `attrfilter(labels, "${DEPLOYMENT_DOMAIN_LABEL}", //...)`;
  const result = await $({
    cwd: root,
    stdio: "pipe",
    env: buckEnv(),
  })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-domain-label-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json --output-attribute name`.quiet();
  assert.deepEqual(parseCqueryTargets(String(result.stdout || "{}")), expected);
});

test("reviewed non-deployment tests do not acquire the deployment-domain label", async () => {
  const root = process.cwd();
  const sampleScripts = [
    "build-tools/tools/tests/dev/coverage-policy-doc-check.test.ts",
    "build-tools/tools/tests/lib/providers.patch-filename.policy.test.ts",
  ];
  const query = `set(${sampleScripts.map(autoZxTargetForScript).join(" ")})`;
  const result = await $({
    cwd: root,
    stdio: "pipe",
    env: buckEnv(),
  })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-domain-negative-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json --output-attribute labels`.quiet();
  const labelsByTarget = parseCqueryLabels(String(result.stdout || "{}"));
  for (const script of sampleScripts) {
    const target = autoZxTargetForScript(script);
    assert.ok(labelsByTarget.has(target), `expected cquery labels for ${target}`);
    assert.ok(
      !(labelsByTarget.get(target) || []).includes(DEPLOYMENT_DOMAIN_LABEL),
      `expected ${target} to stay outside ${DEPLOYMENT_DOMAIN_LABEL}`,
    );
  }
});
