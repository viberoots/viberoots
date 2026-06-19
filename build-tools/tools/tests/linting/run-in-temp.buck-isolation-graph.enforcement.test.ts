#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { collectRunInTempScanFiles } from "./run-in-temp-buck-isolation-graph.ts";
import {
  collectIsolationFragmentHelpersForFiles,
  findExplicitIsolationViolations,
  normalizeRelPath,
} from "./run-in-temp-buck-isolation-lint.ts";

async function tempRepo(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".viberoots", "workspace", "buck", "tmp");
  await fsp.mkdir(base, { recursive: true });
  return fsp.mkdtemp(path.join(base, `${prefix}-`));
}

function rels(repo: string, files: string[]): string[] {
  return files.map((file) => normalizeRelPath(path.relative(repo, file)));
}

test("runInTemp isolation graph scans imported helper files", async () => {
  const repo = await tempRepo("isolation-lint");
  const tests = path.join(repo, "build-tools/tools/tests/linting");
  await fsp.mkdir(tests, { recursive: true });
  await fsp.writeFile(
    path.join(tests, "fixture.test.ts"),
    'import { buckWithIso } from "./fixture-helper";\nrunInTemp("x", () => buckWithIso("x"));\n',
  );
  await fsp.writeFile(
    path.join(tests, "fixture-helper.ts"),
    "export function buckWithIso(iso: string): string { return `buck2 --isolation-dir ${iso} build //:x`; }\n",
  );
  const scanned = await collectRunInTempScanFiles(repo);
  if (!rels(repo, scanned).includes("build-tools/tools/tests/linting/fixture-helper.ts")) {
    throw new Error(`expected helper to be scanned, got ${JSON.stringify(rels(repo, scanned))}`);
  }
  const helpers = await collectIsolationFragmentHelpersForFiles(scanned);
  if (helpers.length !== 0) throw new Error(`expected no fragment helpers, got ${helpers}`);
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation graph scans participating outside-tree helpers", async () => {
  const repo = await tempRepo("isolation-outside");
  const testDir = path.join(repo, "build-tools/tools/tests/linting");
  const helperDir = path.join(repo, "build-tools/tools/deployments");
  await fsp.mkdir(testDir, { recursive: true });
  await fsp.mkdir(helperDir, { recursive: true });
  await fsp.writeFile(
    path.join(testDir, "fixture.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { queryTarget } from "../../deployments/query-helper";',
      'import { queryViaWrapper } from "../../deployments/query-wrapper";',
      'import { queryViaExpressionWrapper } from "../../deployments/query-wrapper";',
      'import { formatDeploymentName } from "../../deployments/name-helper";',
      'import { unusedBuckQuery } from "../../deployments/unused-buck-helper";',
      'runInTemp("x", async (tmp, $) => queryTarget($, tmp));',
      'runInTemp("wrapped", async (tmp, $) => queryViaWrapper($, tmp));',
      'runInTemp("expr-wrapped", async (tmp, $) => queryViaExpressionWrapper($, tmp));',
      'formatDeploymentName("demo");',
      'unusedBuckQuery($, "outside-run-in-temp");',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(helperDir, "query-helper.ts"),
    "export async function queryTarget($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  await fsp.writeFile(
    path.join(helperDir, "query-wrapper.ts"),
    [
      'import { queryTarget } from "./query-helper";',
      'import { unusedNestedBuckQuery } from "./unused-nested-buck-helper";',
      "export const queryViaWrapper = async ($: any, tmp: string): Promise<void> => {",
      "  await queryTarget($, tmp);",
      "};",
      "export const queryViaExpressionWrapper = async ($: any, tmp: string): Promise<void> =>",
      "  queryTarget($, tmp);",
      "export async function unrelatedWrapper($: any, tmp: string): Promise<void> { await unusedNestedBuckQuery($, tmp); }",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(helperDir, "name-helper.ts"),
    "export function formatDeploymentName(name: string): string { return `deployment-${name}`; }\n",
  );
  await fsp.writeFile(
    path.join(helperDir, "unused-buck-helper.ts"),
    "export async function unusedBuckQuery($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  await fsp.writeFile(
    path.join(helperDir, "unrelated-helper.ts"),
    "export async function unrelated($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  await fsp.writeFile(
    path.join(helperDir, "unused-nested-buck-helper.ts"),
    "export async function unusedNestedBuckQuery($: any, tmp: string): Promise<void> { await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`; }\n",
  );
  const scanned = rels(repo, await collectRunInTempScanFiles(repo));
  if (!scanned.includes("build-tools/tools/deployments/query-helper.ts")) {
    throw new Error(`expected outside helper to be scanned, got ${JSON.stringify(scanned)}`);
  }
  if (scanned.includes("build-tools/tools/deployments/query-wrapper.ts")) {
    throw new Error(
      `expected traversal-only wrapper to stay unscanned, got ${JSON.stringify(scanned)}`,
    );
  }
  if (scanned.includes("build-tools/tools/deployments/unrelated-helper.ts")) {
    throw new Error(`expected unrelated outside helper to stay unscanned, got ${scanned}`);
  }
  if (scanned.includes("build-tools/tools/deployments/name-helper.ts")) {
    throw new Error(`expected imported non-command helper to stay unscanned, got ${scanned}`);
  }
  if (scanned.includes("build-tools/tools/deployments/unused-buck-helper.ts")) {
    throw new Error(`expected outside-runInTemp buck helper to stay unscanned, got ${scanned}`);
  }
  if (scanned.includes("build-tools/tools/deployments/unused-nested-buck-helper.ts")) {
    throw new Error(`expected wrapper-unrelated buck helper to stay unscanned, got ${scanned}`);
  }
  const helperText = await fsp.readFile(path.join(helperDir, "query-helper.ts"), "utf8");
  const hits = findExplicitIsolationViolations(
    helperText,
    "build-tools/tools/deployments/query-helper.ts",
  );
  if (hits.length !== 1) throw new Error(`expected outside helper violation, got ${hits}`);
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation graph merges helper exports across roots", async () => {
  const repo = await tempRepo("isolation-multi-root");
  const testDir = path.join(repo, "build-tools/tools/tests/linting");
  const helperDir = path.join(repo, "build-tools/tools/deployments");
  await fsp.mkdir(testDir, { recursive: true });
  await fsp.mkdir(helperDir, { recursive: true });
  await fsp.writeFile(
    path.join(testDir, "a-name.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { formatDeploymentName } from "../../deployments/query-helper";',
      'runInTemp("name", async () => formatDeploymentName("demo"));',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(testDir, "z-query.test.ts"),
    [
      'import { runInTemp } from "../lib/test-helpers";',
      'import { queryTarget } from "../../deployments/query-helper";',
      'runInTemp("query", async (tmp, $) => queryTarget($, tmp));',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(helperDir, "query-helper.ts"),
    [
      "export function formatDeploymentName(name: string): string { return `deployment-${name}`; }",
      "export async function queryTarget($: any, tmp: string): Promise<void> {",
      "  await $`buck2 --isolation-dir ${isoForTmp(tmp)} cquery //:x`;",
      "}",
      "",
    ].join("\n"),
  );
  const scanned = rels(repo, await collectRunInTempScanFiles(repo));
  if (!scanned.includes("build-tools/tools/deployments/query-helper.ts")) {
    throw new Error(`expected later buck export to scan helper, got ${JSON.stringify(scanned)}`);
  }
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation graph composes imported helper-returned fragments", async () => {
  const helperBodies = [
    "export function isoFlag(tmp: string): string { return `--isolation-dir ${isoForTmp(tmp)}`; }",
    "export const isoFlag = (tmp: string): string => `--isolation-dir ${isoForTmp(tmp)}`;",
  ];
  for (const helperBody of helperBodies) {
    const repo = await tempRepo("isolation-fragment");
    const tests = path.join(repo, "build-tools/tools/tests/linting");
    await fsp.mkdir(tests, { recursive: true });
    const testFile = path.join(tests, "fixture.test.ts");
    await fsp.writeFile(
      testFile,
      [
        'import { runInTemp } from "../lib/test-helpers";',
        'import { isoFlag } from "./fixture-helper";',
        'runInTemp("x", async (tmp, $) => $`buck2 ${isoFlag(tmp)} build //:x`);',
        "",
      ].join("\n"),
    );
    await fsp.writeFile(path.join(tests, "fixture-helper.ts"), `${helperBody}\n`);
    const helpers = await collectIsolationFragmentHelpersForFiles(
      await collectRunInTempScanFiles(repo),
    );
    if (!helpers.includes("isoFlag")) throw new Error(`expected isoFlag, got ${helpers}`);
    const hits = findExplicitIsolationViolations(await fsp.readFile(testFile, "utf8"), "", helpers);
    if (hits.length !== 1 || !hits[0]?.reason.includes("fragment")) {
      throw new Error(`expected composed fragment violation, got ${JSON.stringify(hits)}`);
    }
    await fsp.rm(repo, { recursive: true, force: true });
  }
});
