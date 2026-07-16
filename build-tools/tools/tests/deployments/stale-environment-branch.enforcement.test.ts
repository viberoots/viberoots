#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEPLOYMENT_SOURCE_FILE_EXTENSIONS,
  scanDeploymentEnvironmentBranchText,
  STALE_BRANCH_REQUIREMENT,
} from "../../deployments/deployment-environment-branch-scanner";
import { viberootsRepoPath } from "./deployment-command";

const repoRoot = process.cwd();
const activeDocs = [
  "docs/history/plans/deployment-plan.md",
  "docs/deployments-contract.md",
  "docs/history/designs/deployments-design.md",
  "docs/deployments-schema.md",
  "docs/deployments-usage.md",
  "docs/deployment-scenarios.md",
  "docs/history/plans/deployments-implementation-plan.md",
  "docs/deployment-provider-capabilities.md",
  "docs/deployment-control-plane-observability.md",
  "docs/handbook/ci.md",
  "docs/nixos-shared-host-technician-checklist.md",
];
const sourceRoots = [
  "build-tools/deployments",
  "build-tools/tools/deployments",
  "viberoots/build-tools/tools/scaffolding/templates/deployment",
];

function ownedPath(relPath: string): string {
  if (relPath.startsWith("projects/")) return path.join(repoRoot, relPath);
  return viberootsRepoPath(relPath);
}

async function walkFiles(root: string): Promise<string[]> {
  const abs = ownedPath(root);
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const rel = path.posix.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(rel)));
    else if (DEPLOYMENT_SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) files.push(rel);
  }
  return files;
}

async function scanFile(relPath: string): Promise<string[]> {
  const text = await fsp.readFile(ownedPath(relPath), "utf8");
  return scanDeploymentEnvironmentBranchText(relPath, text);
}

test("active deployment sources and normative docs reject environment-branch authority", async () => {
  const sourceFiles = (await Promise.all(sourceRoots.map(walkFiles))).flat();
  const files = [...activeDocs, ...sourceFiles];
  const errors = (await Promise.all(files.map(scanFile))).flat();
  assert.deepEqual(errors, []);
});

test("stale branch enforcement catches full Git ref authority examples", () => {
  assert.match('allowed_refs = ["env/app/prod"]', STALE_BRANCH_REQUIREMENT);
  assert.match('allowed_refs = ["refs/heads/env/app/prod"]', STALE_BRANCH_REQUIREMENT);
  assert.match('source_ref_policy = {"prod": "refs/heads/env/app/prod"}', STALE_BRANCH_REQUIREMENT);
  assert.doesNotMatch('allowed_refs = ["refs/tags/env/app/prod"]', STALE_BRANCH_REQUIREMENT);
  assert.doesNotMatch(
    'source_ref_policy = {"prod": "refs/tags/env/app/prod"}',
    STALE_BRANCH_REQUIREMENT,
  );
});

test("stale branch scanner preserves negative and negated examples", () => {
  assert.deepEqual(
    scanDeploymentEnvironmentBranchText("projects/deployments/demo/TARGETS", "stage_branches = []"),
    [
      "projects/deployments/demo/TARGETS: must not expose stage_branches in active deployment files",
    ],
  );
  assert.deepEqual(
    scanDeploymentEnvironmentBranchText(
      "projects/deployments/demo/README.md",
      "environment branches must not be normal authority",
    ),
    [],
  );
});

test("deployment plan records the adjusted protected/shared model", async () => {
  const plan = await fsp.readFile(
    viberootsRepoPath("docs/history/plans/deployment-plan.md"),
    "utf8",
  );
  assert.match(
    plan,
    /Git-triggered, CI-built, Buck2-defined,\s+control-plane-admitted deployments/i,
  );
});
