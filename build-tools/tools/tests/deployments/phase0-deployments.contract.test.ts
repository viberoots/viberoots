#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveAllDeployments } from "../../deployments/deployment-query";
import { scanRepositoryRefs } from "../../deployments/sprinkleref-check-scan";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const REMOVED_DEPLOYMENT_ROOTS = new Set([
  "platform-foundation",
  "platform-shared",
  "example-console",
  "example-web",
  "example-worker",
]);
const REMOVED_LEGACY_PREFIX = ["data", "room"].join("-");
const REMOVED_LEGACY_UNDERSCORE = ["data", "room"].join("_");
const REMOVED_LABELS = [
  "//projects/deployments/platform-foundation-prod:deploy",
  "//projects/deployments/platform-shared:lane",
  "//projects/deployments/example-console-prod:deploy",
  "//projects/deployments/example-web-prod:deploy",
  "//projects/deployments/example-worker-prod:deploy",
];
const OPERATOR_DOCS = [
  "docs/deployments-usage.md",
  "docs/history/designs/deployment-adjustment.md",
  "docs/history/migrations/sample-webapp-deployment-directory-migration.md",
  "docs/secrets-usage.md",
  "docs/deployments-schema.md",
  "docs/history/designs/infisical-design.md",
  "docs/infisical-bootstrap.md",
  "docs/history/migrations/repo-rename.md",
  "infisical-bootstrap.md",
];
const REMOVED_DEPLOYMENT_ID_RE =
  /\b(?:platform-foundation-(?:dev|staging|prod)|platform-shared|example-(?:console|web|worker)-(?:dev|staging|prod))\b/;
const REMOVED_DEPLOYMENT_TEMPLATE_RE =
  /\b(?:platform-foundation-(?:\*|\{env\})|example-(?:console|web|worker)-(\*|\{env\})|example-\{web,worker\}-\{env\})\b/;
const removedLegacyDeploymentIdRe = new RegExp(
  `\\b(?:${REMOVED_LEGACY_PREFIX}-(?:console|web|worker)(?:-(?:dev|staging|prod))?|${REMOVED_LEGACY_UNDERSCORE})\\b`,
);

async function removedDeploymentRootEntries(): Promise<string[]> {
  const result = await $({ stdio: "pipe" })`git ls-files -- projects/deployments`;
  return String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace("projects/deployments/", ""))
    .filter((line) => line.includes("/"))
    .map((line) => line.split("/")[0])
    .filter((name) => !name.startsWith("."))
    .filter((name) => REMOVED_DEPLOYMENT_ROOTS.has(name))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
}

test("checked-in deployment packages do not include removed phase-0 families", async () => {
  assert.deepEqual(await removedDeploymentRootEntries(), []);
});

test("deleted speculative deployment labels are not resolvable", async () => {
  const result = await $({
    env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    stdio: "pipe",
  })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-package-guard")} cquery --target-platforms prelude//platforms:default ${`set(${REMOVED_LABELS.join(" ")})`}`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(`${String(result.stdout)}\n${String(result.stderr)}`, /example|platform/);
});

test("repo deployment discovery does not return removed phase-0 deployments", async () => {
  const deployments = await resolveAllDeployments(process.cwd());
  assert.deepEqual(
    deployments
      .map((deployment) => deployment.label)
      .filter((label) => /example|platform-foundation|platform-shared/.test(label)),
    [],
  );
});

test("operator-facing deployment docs do not advertise removed labels", async () => {
  for (const relPath of OPERATOR_DOCS) {
    const filePath = path.join(process.cwd(), relPath);
    const text = await fsp.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    assert.doesNotMatch(
      text,
      /(?:\/\/)?projects\/deployments\/(?:example|platform-foundation|platform-shared)/,
      relPath,
    );
    assert.doesNotMatch(
      text,
      /(?:platform-\*|example-\*)[^.\n]*(?:remain|current|live|inventory|legacy flat package layout)/i,
      relPath,
    );
    assert.doesNotMatch(text, REMOVED_DEPLOYMENT_ID_RE, relPath);
    assert.doesNotMatch(text, REMOVED_DEPLOYMENT_TEMPLATE_RE, relPath);
    assert.doesNotMatch(text, removedLegacyDeploymentIdRe, relPath);
  }
});

test("SprinkleRef repository scan does not find removed deployment contracts", async () => {
  const scanned = await scanRepositoryRefs(process.cwd());
  assert.deepEqual(
    scanned.refs
      .map((entry) => entry.ref)
      .filter(
        (ref) =>
          /deployments\/phase0\/|example|platform-foundation/.test(ref) ||
          ref.includes(REMOVED_LEGACY_PREFIX) ||
          ref.includes(REMOVED_LEGACY_UNDERSCORE),
      ),
    [],
  );
});
