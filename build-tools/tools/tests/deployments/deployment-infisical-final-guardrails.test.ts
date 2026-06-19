#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

const repoRoot = process.cwd();
const providerPrefixes = [
  "app-store-connect",
  "cloudflare",
  "google-play",
  "kubernetes",
  "nixos-shared-host",
  "opentofu",
  "s3-static",
  "vercel",
];
const allowedInfisicalImports = new Set([
  "deployment-admin-infisical.ts",
  "deployment-admin-infisical-cli.ts",
  "deployment-admin-infisical-diagnostic.ts",
  "deployment-auth-infisical-diagnostics.ts",
  "deployment-secret-admission.ts",
  "deployment-secret-backend-registry.ts",
  "deployment-secret-context.ts",
  "deployment-secret-infisical-client.ts",
  "deployment-secret-infisical-runtime-worker.ts",
  "deployment-secret-runtime-worker.ts",
  "deployment-secret-worker-runtime-metadata.ts",
]);
const checkedInMetadataRoots = ["projects/deployments", "build-tools/deployments"];
const docsWithInfisicalExamples = [
  "docs/deployment-secrets-api.md",
  "docs/deployments-usage.md",
  "docs/history/migrations/mini-name-migration-instructions.md",
  "docs/nixos-shared-host-setup.md",
  "docs/nixos-shared-host-usage.md",
  "docs/secrets-usage.md",
];
const docsWithInfisicalResolverExamples = [
  ...docsWithInfisicalExamples,
  "docs/history/designs/infisical-design.md",
  "docs/history/designs/infisical-bootstrap-spec.md",
];

async function walkFiles(
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === ".terraform") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && predicate(fullPath)) out.push(fullPath);
    }
  }
  await visit(root);
  return out.sort();
}

async function readRelative(relPath: string): Promise<string> {
  const filePath =
    relPath.startsWith("build-tools/") || relPath.startsWith("docs/")
      ? viberootsRepoPath(relPath)
      : path.join(repoRoot, relPath);
  return await fsp.readFile(filePath, "utf8");
}

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

test("provider source does not import Infisical backend internals directly", async () => {
  const files = await walkFiles(viberootsRepoPath("build-tools/tools/deployments"), (filePath) =>
    filePath.endsWith(".ts"),
  );
  const violations: string[] = [];
  for (const filePath of files) {
    const base = path.basename(filePath);
    if (!providerPrefixes.some((prefix) => base.startsWith(prefix))) continue;
    if (allowedInfisicalImports.has(base)) continue;
    const text = await fsp.readFile(filePath, "utf8");
    if (/from "\.\/deployment-secret-infisical/.test(text)) violations.push(relative(filePath));
  }
  assert.deepEqual(violations, []);
});

test("checked-in deployment metadata keeps Infisical secret material out of repo state", async () => {
  const files = (
    await Promise.all(
      checkedInMetadataRoots.map((root) =>
        walkFiles(
          root.startsWith("build-tools/") ? viberootsRepoPath(root) : path.join(repoRoot, root),
          (filePath) => /\.(bzl|json|md|nix|tf)$/.test(filePath),
        ),
      ),
    )
  ).flat();
  const forbidden = [
    /\bINFISICAL_ACCESS_TOKEN\s*=/,
    /\bINFISICAL_TOKEN\s*=/,
    /\bINFISICAL_PERSONAL_TOKEN\s*=/,
    /\binfisical_access_token\b/i,
    /\binfisical_personal_token\b/i,
    /\bclient_secret\s*[:=]\s*["'][^"']+["']/i,
    /\bsecret_value\s*[:=]\s*["'][^"']+["']/i,
  ];
  const violations: string[] = [];
  for (const filePath of files) {
    const text = await fsp.readFile(filePath, "utf8");
    forbidden.forEach((pattern) => {
      if (pattern.test(text)) violations.push(`${relative(filePath)} matches ${pattern}`);
    });
  }
  assert.deepEqual(violations, []);
});

test("Infisical docs keep examples non-secret and admin commands read-only", async () => {
  const docs = await Promise.all(docsWithInfisicalExamples.map(readRelative));
  const combined = docs.join("\n");
  const bashBlocks = combined.match(/```bash\n[\s\S]*?\n```/g) || [];
  for (const block of bashBlocks) assert.doesNotMatch(block, /\bdeploy admin infisical sync\b/);
  assert.doesNotMatch(combined, /^deploy admin infisical sync\b/m);
  assert.doesNotMatch(combined, /\bexport\s+INFISICAL_(?:ACCESS_)?TOKEN=/);
  assert.doesNotMatch(combined, /\bexport\s+INFISICAL_PERSONAL_TOKEN=/);
  assert.doesNotMatch(combined, /secretValue\s*[:=]\s*["'][^"']+["']/);
  assert.match(combined, /createDeploymentSecretRuntimeForAdmittedContext\(\)/);
  assert.match(combined, /createVaultDeploymentSecretRuntime\(\)[\s\S]*compatibility helper/);
});

test("Infisical resolver docs show Universal Auth profile fields", async () => {
  for (const relPath of docsWithInfisicalResolverExamples) {
    const text = await readRelative(relPath);
    const jsonBlocks = text.match(/```json\n[\s\S]*?\n```/g) || [];
    for (const block of jsonBlocks) {
      if (!block.includes('"backend": "infisical"') || !block.includes('"defaultEnvironment"')) {
        continue;
      }
      assert.match(block, /"clientIdRef"\s*:/, relPath);
      assert.match(block, /"clientSecretRef"\s*:/, relPath);
      assert.doesNotMatch(block, /"tokenEnv"\s*:/, relPath);
    }
  }
});

test("Infisical plan keeps follow-up sections traceable", async () => {
  const plan = await readRelative("docs/history/plans/infisical-plan.md");
  const prefix = "PR" + "-";
  for (const pr of [16, 17, 18]) {
    assert.match(plan, new RegExp(`^## ${prefix}${pr}: `, "m"));
  }
  assert.match(
    plan,
    new RegExp(`Traceability note: ${prefix}16 through ${prefix}18 are assessment-driven`),
  );
});
