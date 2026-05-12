#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { collectRunInTempScanFiles } from "./run-in-temp-buck-isolation-graph.ts";
import { normalizeRelPath } from "./run-in-temp-buck-isolation-lint.ts";

async function fixtureRepo(
  prefix: string,
): Promise<{ repo: string; testDir: string; helperDir: string }> {
  const repo = await fsp.mkdtemp(path.join(process.cwd(), `buck-out/tmp/${prefix}-`));
  const testDir = path.join(repo, "build-tools/tools/tests/linting");
  const helperDir = path.join(repo, "build-tools/tools/deployments");
  await fsp.mkdir(testDir, { recursive: true });
  await fsp.mkdir(helperDir, { recursive: true });
  return { repo, testDir, helperDir };
}

async function scannedRels(repo: string): Promise<string[]> {
  return (await collectRunInTempScanFiles(repo)).map((file) =>
    normalizeRelPath(path.relative(repo, file)),
  );
}

test("runInTemp isolation graph follows outside-tree re-export wrappers", async () => {
  const { repo, testDir, helperDir } = await fixtureRepo("isolation-reexport");
  await fsp.writeFile(
    path.join(testDir, "fixture.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { queryTarget } from "../../deployments/query-barrel";',
      'import { starQuery } from "../../deployments/star-barrel";',
      'runInTemp("query", async (tmp, $) => queryTarget($, tmp));',
      'runInTemp("star", async (tmp, $) => starQuery($, tmp));',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(helperDir, "query-barrel.ts"),
    'export { queryTarget } from "./query-helper";\n',
  );
  await fsp.writeFile(path.join(helperDir, "star-barrel.ts"), 'export * from "./star-helper";\n');
  await fsp.writeFile(
    path.join(helperDir, "query-helper.ts"),
    "export async function queryTarget($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  await fsp.writeFile(
    path.join(helperDir, "star-helper.ts"),
    "export async function starQuery($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  const scanned = await scannedRels(repo);
  for (const rel of [
    "build-tools/tools/deployments/query-helper.ts",
    "build-tools/tools/deployments/star-helper.ts",
  ]) {
    if (!scanned.includes(rel)) throw new Error(`expected ${rel}, got ${JSON.stringify(scanned)}`);
  }
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation graph follows aliased named imports", async () => {
  const { repo, testDir, helperDir } = await fixtureRepo("isolation-alias");
  await fsp.writeFile(
    path.join(testDir, "fixture.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { queryTarget as runQuery } from "../../deployments/query-helper";',
      'runInTemp("query", async (tmp, $) => runQuery($, tmp));',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(helperDir, "query-helper.ts"),
    "export async function queryTarget($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  const scanned = await scannedRels(repo);
  if (!scanned.includes("build-tools/tools/deployments/query-helper.ts")) {
    throw new Error(`expected aliased helper import to be scanned, got ${JSON.stringify(scanned)}`);
  }
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation graph bounds star re-export scans to used names", async () => {
  const { repo, testDir, helperDir } = await fixtureRepo("isolation-reexport-bound");
  await fsp.writeFile(
    path.join(testDir, "fixture.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { formatDeploymentName } from "../../deployments/star-barrel";',
      'runInTemp("name", async () => formatDeploymentName("demo"));',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(path.join(helperDir, "star-barrel.ts"), 'export * from "./mixed-helper";\n');
  await fsp.writeFile(
    path.join(helperDir, "mixed-helper.ts"),
    [
      "export function formatDeploymentName(name: string): string { return `deployment-${name}`; }",
      "export async function unrelatedBuck($: any, tmp: string): Promise<void> {",
      "  await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`;",
      "}",
      "",
    ].join("\n"),
  );
  const scanned = await scannedRels(repo);
  if (scanned.includes("build-tools/tools/deployments/mixed-helper.ts")) {
    throw new Error(`expected non-command star export to stay unscanned, got ${scanned}`);
  }
  await fsp.rm(repo, { recursive: true, force: true });
});
