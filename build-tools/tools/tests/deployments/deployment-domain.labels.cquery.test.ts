#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEPLOYMENT_DOMAIN_LABEL,
  REVIEWED_DEPLOYMENT_TEST_AREA,
} from "../../lib/deployment-verify-scope";
import { VERIFY_RESOURCE_LIMITED_LABEL } from "../../dev/verify/target-passes";
import { resolveNestedBuckIsolation } from "../../lib/buck-command-env";
import { normalizeTargetLabel } from "../../lib/labels";

const RESOURCE_LIMITED_EXEMPT_TEMP_REPO_SCRIPTS = new Set([
  "build-tools/tools/tests/deployments/app-store-connect.e2e.test.ts",
  "build-tools/tools/tests/deployments/cloudflare-pages.promotion.guardrails.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.observability.test.ts",
  "build-tools/tools/tests/deployments/deployment-targets.install.cloudflare.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.governance.service.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.host-module.nix-eval.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.pr95.realm-files.nix-eval.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.install.host-modes.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.install.ssh-guess.test.ts",
  "build-tools/tools/tests/deployments/static-webapp-artifact-admission.test.ts",
]);

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

async function deploymentTempRepoTestScripts(root: string): Promise<string[]> {
  const scripts = await deploymentTestScripts(root);
  const out: string[] = [];
  for (const script of scripts) {
    const body = await fsp.readFile(path.join(root, script), "utf8");
    if (/\bimport\s*\{[^}]*\brunInTemp\b[^}]*\}/.test(body) && /\brunInTemp\s*\(/.test(body)) {
      out.push(script);
    }
  }
  return out;
}

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

async function runCqueryWithScopedIsolation(opts: {
  root: string;
  isolationPrefix: string;
  query: string;
  attrs: string[];
}): Promise<string> {
  const { isolationDir, ownsIsolation } = resolveNestedBuckIsolation({
    root: opts.root,
    prefix: opts.isolationPrefix,
  });
  try {
    const result = await $({
      cwd: opts.root,
      stdio: "pipe",
      env: buckEnv(),
    })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms prelude//platforms:default ${opts.query} --json ${opts.attrs.flatMap((attr) => ["--output-attribute", attr])}`.quiet();
    return String(result.stdout || "{}");
  } finally {
    if (ownsIsolation) {
      await $({
        cwd: opts.root,
        stdio: "ignore",
        reject: false,
        env: buckEnv(),
      })`buck2 --isolation-dir ${isolationDir} kill`;
    }
  }
}

test("deployment-domain label cquery resolves the reviewed deployment test suite", async () => {
  const root = process.cwd();
  const expected = (await deploymentTestScripts(root)).map(autoZxTargetForScript).sort();
  const query = `attrfilter(labels, "${DEPLOYMENT_DOMAIN_LABEL}", //...)`;
  const stdout = await runCqueryWithScopedIsolation({
    root,
    isolationPrefix: "deployment-domain-label-cquery",
    query,
    attrs: ["name"],
  });
  assert.deepEqual(parseCqueryTargets(stdout), expected);
});

test("resource-heavy deployment tests receive bounded verify scheduling labels", async () => {
  const root = process.cwd();
  const scripts = [
    "build-tools/tools/tests/deployments/nixos-shared-host.reuse.e2e.test.ts",
    "build-tools/tools/tests/deployments/deployment-control-plane.bootstrap.test.ts",
  ];
  const query = `set(${scripts.map(autoZxTargetForScript).join(" ")})`;
  const stdout = await runCqueryWithScopedIsolation({
    root,
    isolationPrefix: "deployment-resource-limited-cquery",
    query,
    attrs: ["labels"],
  });
  const labelsByTarget = parseCqueryLabels(stdout);
  for (const script of scripts) {
    const target = autoZxTargetForScript(script);
    assert.ok(labelsByTarget.has(target), `expected cquery labels for ${target}`);
    assert.ok(
      (labelsByTarget.get(target) || []).includes(VERIFY_RESOURCE_LIMITED_LABEL),
      `expected ${target} to include ${VERIFY_RESOURCE_LIMITED_LABEL}`,
    );
  }
});

test("deployment temp-repo tests receive measured bounded verify scheduling labels", async () => {
  const root = process.cwd();
  const scripts = await deploymentTempRepoTestScripts(root);
  assert.ok(scripts.length > 100, "expected deployment temp-repo coverage to stay explicit");
  const query = `set(${scripts.map(autoZxTargetForScript).join(" ")})`;
  const stdout = await runCqueryWithScopedIsolation({
    root,
    isolationPrefix: "deployment-temp-repo-resource-limited-cquery",
    query,
    attrs: ["labels"],
  });
  const labelsByTarget = parseCqueryLabels(stdout);
  for (const script of scripts) {
    const target = autoZxTargetForScript(script);
    assert.ok(labelsByTarget.has(target), `expected cquery labels for ${target}`);
    const hasResourceLimitedLabel = (labelsByTarget.get(target) || []).includes(
      VERIFY_RESOURCE_LIMITED_LABEL,
    );
    if (RESOURCE_LIMITED_EXEMPT_TEMP_REPO_SCRIPTS.has(script)) {
      assert.ok(
        !hasResourceLimitedLabel,
        `expected measured shared-lane deployment target ${target} to omit ${VERIFY_RESOURCE_LIMITED_LABEL}`,
      );
    } else {
      assert.ok(
        hasResourceLimitedLabel,
        `expected temp-repo deployment target ${target} to include ${VERIFY_RESOURCE_LIMITED_LABEL}`,
      );
    }
  }
});

test("reviewed non-deployment tests do not acquire the deployment-domain label", async () => {
  const root = process.cwd();
  const sampleScripts = [
    "build-tools/tools/tests/dev/coverage-policy-doc-check.test.ts",
    "build-tools/tools/tests/lib/providers.patch-filename.policy.test.ts",
  ];
  const query = `set(${sampleScripts.map(autoZxTargetForScript).join(" ")})`;
  const stdout = await runCqueryWithScopedIsolation({
    root,
    isolationPrefix: "deployment-domain-negative-cquery",
    query,
    attrs: ["labels"],
  });
  const labelsByTarget = parseCqueryLabels(stdout);
  for (const script of sampleScripts) {
    const target = autoZxTargetForScript(script);
    assert.ok(labelsByTarget.has(target), `expected cquery labels for ${target}`);
    assert.ok(
      !(labelsByTarget.get(target) || []).includes(DEPLOYMENT_DOMAIN_LABEL),
      `expected ${target} to stay outside ${DEPLOYMENT_DOMAIN_LABEL}`,
    );
  }
});
