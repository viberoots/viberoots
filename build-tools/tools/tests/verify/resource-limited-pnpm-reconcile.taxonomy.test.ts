import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const testsRoot = path.join(root, "build-tools/tools/tests");

async function testFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await testFiles(abs)));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(abs);
  }
  return out;
}

test("tests that invoke public pnpm reconciliation use the resource-limited lane", async () => {
  const taxonomy = await fsp.readFile(
    path.join(testsRoot, "resource_limited_taxonomy.bzl"),
    "utf8",
  );
  const missing: string[] = [];

  for (const abs of await testFiles(testsRoot)) {
    const source = await fsp.readFile(abs, "utf8");
    const reconciles = /await\s+reconcileTempDependencyInputs\s*\(/.test(source);
    const usesReconciledScaffold = /await\s+scaffoldAndPrepareWorkspace\s*\(/.test(source);
    if (!reconciles && !usesReconciledScaffold) continue;
    const rel = path.relative(root, abs).split(path.sep).join(path.posix.sep);
    if (!taxonomy.includes(`${JSON.stringify(rel)}: True`)) missing.push(rel);
  }

  assert.deepEqual(missing, []);
});
