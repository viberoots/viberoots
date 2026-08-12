import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  planVerifyTargetPasses,
  VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  VERIFY_ISOLATED_LABEL,
  VERIFY_RESOURCE_LIMITED_LABEL,
} from "../../dev/verify/target-passes";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const testsRoot = path.join(root, "build-tools/tools/tests");
const scaffoldingRoot = path.join(testsRoot, "scaffolding");

async function testFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await testFiles(abs)));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(abs);
  }
  return out;
}

test("tests that invoke public pnpm reconciliation use a constrained lane", async () => {
  const taxonomy = await fsp.readFile(
    path.join(testsRoot, "resource_limited_taxonomy.bzl"),
    "utf8",
  );
  const isolatedTaxonomy = await fsp.readFile(
    path.join(testsRoot, "isolated_test_conventions.bzl"),
    "utf8",
  );
  const missing: string[] = [];
  const isolatedReconciliationTests: string[] = [];

  const directPublicUpdateTests: string[] = [];
  for (const abs of await testFiles(testsRoot)) {
    const source = await fsp.readFile(abs, "utf8");
    const reconciles = /await\s+reconcileTempDependencyInputs\s*\(/.test(source);
    const usesReconciledScaffold = /await\s+scaffoldAndPrepareWorkspace\s*\(/.test(source);
    const invokesPublicUpdate =
      abs.startsWith(`${scaffoldingRoot}${path.sep}`) &&
      /viberoots\/build-tools\/tools\/bin\/u\b/.test(source);
    const invokesUpdateLauncher =
      /runUpdateCommand/.test(source) &&
      /from\s+["']\.\/update-command-launcher\.fixture["']/.test(source);
    if (!reconciles && !usesReconciledScaffold && !invokesPublicUpdate && !invokesUpdateLauncher) {
      continue;
    }
    const rel = path.relative(root, abs).split(path.sep).join(path.posix.sep);
    if (invokesPublicUpdate || invokesUpdateLauncher) directPublicUpdateTests.push(rel);
    const isResourceLimited = taxonomy.includes(`${JSON.stringify(rel)}: True`);
    const isIsolated = isolatedTaxonomy.includes(`${JSON.stringify(rel)}: True`);
    if (isIsolated) isolatedReconciliationTests.push(rel);
    if (!isResourceLimited && !isIsolated) missing.push(rel);
  }

  assert.deepEqual(missing, []);
  assert.deepEqual(directPublicUpdateTests.sort(), [
    "build-tools/tools/tests/dev/update-command.launcher.integration.test.ts",
    "build-tools/tools/tests/scaffolding/go-app.auto-wires-go-tests.test.ts",
    "build-tools/tools/tests/scaffolding/go-cli.simple-patched-uuid.runtime.test.ts",
    "build-tools/tools/tests/scaffolding/go-lib.auto-wires-go-tests.test.ts",
    "build-tools/tools/tests/scaffolding/partial-clone.discover-and-build.test.ts",
    "build-tools/tools/tests/scaffolding/provider-wiring.scaffold-patch.test.ts",
    "build-tools/tools/tests/scaffolding/scaf-go-test.cli.auto-wires.test.ts",
    "build-tools/tools/tests/scaffolding/scaf-go-test.lib.auto-wires.test.ts",
  ]);
  assert.deepEqual(isolatedReconciliationTests.sort(), [
    "build-tools/tools/tests/rust/rust.native-build.rejects-cross-root-deps.test.ts",
    "build-tools/tools/tests/scaffolding/scaf-new.ts.wasm-linking-app.scaffold-and-build.test.ts",
  ]);

  assert.deepEqual(
    planVerifyTargetPasses(
      isolatedReconciliationTests.map((target) => ({
        target,
        labels: [VERIFY_ISOLATED_LABEL],
      })),
    ),
    [
      {
        name: "isolated",
        targets: isolatedReconciliationTests,
        threadsOverride: 1,
      },
    ],
  );

  const broadLaneTargets = [
    ...directPublicUpdateTests,
    ...Array.from(
      { length: VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN - directPublicUpdateTests.length },
      (_, index) => `//:existing-resource-limited-${index}`,
    ),
  ];
  const passes = planVerifyTargetPasses(
    broadLaneTargets.map((target) => ({
      target,
      labels: [VERIFY_RESOURCE_LIMITED_LABEL],
    })),
  );
  assert.deepEqual(passes, [
    {
      name: "resource-limited",
      targets: broadLaneTargets,
      threadsOverride: VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
    },
  ]);
});
