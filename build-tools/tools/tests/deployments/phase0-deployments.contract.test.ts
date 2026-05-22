#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveAllDeployments } from "../../deployments/deployment-query";
import { scanRepositoryRefs } from "../../deployments/sprinkleref-check-scan";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const APPROVED_DEPLOYMENT_ROOTS = new Set(["pleomino"]);
const REMOVED_LABELS = [
  "//projects/deployments/platform-foundation-prod:deploy",
  "//projects/deployments/platform-shared:lane",
  "//projects/deployments/data-room-console-prod:deploy",
  "//projects/deployments/data-room-web-prod:deploy",
  "//projects/deployments/data-room-worker-prod:deploy",
];
const OPERATOR_DOCS = [
  "docs/deployments-usage.md",
  "docs/deployment-adjustment.md",
  "docs/pleomino-deployment-directory-migration.md",
  "docs/secrets-usage.md",
  "docs/deployments-schema.md",
  "docs/infisical-design.md",
  "docs/infisical-bootstrap.md",
  "docs/repo-rename.md",
  "projects/docs/phase_0_architecture.md",
  "projects/docs/phase_0_build_deployment_companion.md",
  "projects/docs/phase_0_engineering_companion.md",
  "infisical-bootstrap.md",
];
const REMOVED_DEPLOYMENT_ID_RE =
  /\b(?:platform-foundation-(?:dev|staging|prod)|platform-shared|data-room-(?:console|web|worker)-(?:dev|staging|prod))\b/;
const REMOVED_DEPLOYMENT_TEMPLATE_RE =
  /\b(?:platform-foundation-(?:\*|\{env\})|data-room-(?:console|web|worker)-(\*|\{env\})|data-room-\{web,worker\}-\{env\})\b/;

async function deploymentRootEntries(): Promise<string[]> {
  const result = await $({ stdio: "pipe" })`git ls-files -- projects/deployments`;
  return String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace("projects/deployments/", ""))
    .filter((line) => line.includes("/"))
    .map((line) => line.split("/")[0])
    .filter((name) => !name.startsWith("."))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
}

test("checked-in deployment packages are limited to approved live families", async () => {
  assert.deepEqual(await deploymentRootEntries(), [...APPROVED_DEPLOYMENT_ROOTS].sort());
});

test("deleted speculative deployment labels are not resolvable", async () => {
  const result = await $({
    env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    stdio: "pipe",
  })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-package-guard")} cquery --target-platforms prelude//platforms:default ${`set(${REMOVED_LABELS.join(" ")})`}`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(`${String(result.stdout)}\n${String(result.stderr)}`, /data-room|platform/);
});

test("repo deployment discovery returns only Pleomino deployments", async () => {
  const deployments = await resolveAllDeployments(process.cwd());
  assert.ok(deployments.length > 0);
  assert.deepEqual(
    [...new Set(deployments.map((deployment) => deployment.deploymentFamily).filter(Boolean))],
    ["pleomino"],
  );
  assert.deepEqual(
    deployments
      .map((deployment) => deployment.label)
      .filter((label) => /data-room|platform-foundation|platform-shared/.test(label)),
    [],
  );
});

test("operator-facing deployment docs do not advertise removed labels", async () => {
  for (const relPath of OPERATOR_DOCS) {
    const text = await fsp.readFile(path.join(process.cwd(), relPath), "utf8");
    assert.doesNotMatch(
      text,
      /(?:\/\/)?projects\/deployments\/(?:data-room|platform-foundation|platform-shared)/,
      relPath,
    );
    assert.doesNotMatch(
      text,
      /(?:platform-\*|data-room-\*)[^.\n]*(?:remain|current|live|inventory|legacy flat package layout)/i,
      relPath,
    );
    assert.doesNotMatch(text, REMOVED_DEPLOYMENT_ID_RE, relPath);
    assert.doesNotMatch(text, REMOVED_DEPLOYMENT_TEMPLATE_RE, relPath);
  }
});

test("SprinkleRef repository scan does not find removed deployment contracts", async () => {
  const scanned = await scanRepositoryRefs(process.cwd());
  assert.deepEqual(
    scanned.refs
      .map((entry) => entry.ref)
      .filter((ref) => /deployments\/phase0\/|data-room|platform-foundation/.test(ref)),
    [],
  );
});
