#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const activeDocs = [
  "docs/deployment-plan.md",
  "docs/deployments-contract.md",
  "docs/deployments-design.md",
  "docs/deployments-schema.md",
  "docs/deployments-usage.md",
  "docs/deployment-scenarios.md",
  "docs/deployments-implementation-plan.md",
  "docs/deployment-provider-capabilities.md",
  "docs/deployment-control-plane-observability.md",
  "docs/handbook/ci.md",
  "docs/nixos-shared-host-technician-checklist.md",
];
const sourceRoots = [
  "build-tools/deployments",
  "build-tools/tools/deployments",
  "build-tools/tools/scaffolding/templates/deployment",
  "projects/deployments",
];
const sourceFileExts = new Set([".bzl", ".ts", ".tsx", ".js", ".json", ".jsonc", ".jinja"]);
const negation =
  /\b(?:not|never|without|instead|reject|rejected|no longer|do not|must not|is not|are not|rather than)\b/i;
const staleBranchRequirement =
  /\b(?:allowed_refs|source_ref_policy|promotion|promote|admission|source authority|source ref)[^\n]*(?:^|[^A-Za-z0-9_./-])(?:refs\/heads\/)?env\/(?:<family>|[A-Za-z0-9_.-]+)\/(?:<stage>|[A-Za-z0-9_.-]+)(?=$|[^A-Za-z0-9_./-])/i;
const releasePointerAuthority =
  /\brelease[- ]pointer[^\n]*(?:authoritative|source of truth|runtime deployment input)\b/i;

async function walkFiles(root: string): Promise<string[]> {
  const abs = path.join(repoRoot, root);
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const rel = path.posix.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(rel)));
    else if (sourceFileExts.has(path.extname(entry.name))) files.push(rel);
  }
  return files;
}

async function scanFile(relPath: string): Promise<string[]> {
  const text = await fsp.readFile(path.join(repoRoot, relPath), "utf8");
  const errors: string[] = [];
  if (/\bstage_branches(?:_required)?\b/.test(text)) {
    errors.push(`${relPath}: must not expose stage_branches in active deployment files`);
  }
  for (const [index, line] of text.split(/\r?\n/g).entries()) {
    if (negation.test(line)) continue;
    if (staleBranchRequirement.test(line)) {
      errors.push(`${relPath}:${index + 1}: environment branch must not be normal authority`);
    }
    if (releasePointerAuthority.test(line)) {
      errors.push(`${relPath}:${index + 1}: release-pointer files must not be authoritative`);
    }
  }
  return errors;
}

test("active deployment sources and normative docs reject environment-branch authority", async () => {
  const sourceFiles = (await Promise.all(sourceRoots.map(walkFiles))).flat();
  const files = [...activeDocs, ...sourceFiles];
  const errors = (await Promise.all(files.map(scanFile))).flat();
  assert.deepEqual(errors, []);
});

test("stale branch enforcement catches full Git ref authority examples", () => {
  assert.match('allowed_refs = ["env/app/prod"]', staleBranchRequirement);
  assert.match('allowed_refs = ["refs/heads/env/app/prod"]', staleBranchRequirement);
  assert.match('source_ref_policy = {"prod": "refs/heads/env/app/prod"}', staleBranchRequirement);
  assert.doesNotMatch('allowed_refs = ["refs/tags/env/app/prod"]', staleBranchRequirement);
  assert.doesNotMatch(
    'source_ref_policy = {"prod": "refs/tags/env/app/prod"}',
    staleBranchRequirement,
  );
});

test("deployment plan records the adjusted protected/shared model", async () => {
  const plan = await fsp.readFile(path.join(repoRoot, "docs/deployment-plan.md"), "utf8");
  assert.match(
    plan,
    /Git-triggered, CI-built, Buck2-defined,\s+control-plane-admitted deployments/i,
  );
});
