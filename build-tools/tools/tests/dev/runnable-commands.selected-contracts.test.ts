#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("p selected runnable builds materialize final pnpm stores before filtered Nix builds", async () => {
  const source = await readRepoFile("build-tools/tools/dev/run-runnable-graph.ts");
  assert.match(source, /resolveFinalPnpmStore/);
  assert.doesNotMatch(source, /import \{ prepareExactPnpmStore \}/);
  assert.doesNotMatch(source, /NIX_PNPM_EXACT_STORE/);
  assert.match(source, /targetPackageFromLabel\(target\)/);
});

test("p selected webapp builds pass viberoots flake source into the planner", async () => {
  const packages = await readRepoFile("build-tools/tools/nix/flake/packages/default.nix");
  const graphPackage = await readRepoFile("build-tools/tools/nix/flake/packages/graph.nix");
  const graphGenerator = await readRepoFile("build-tools/tools/nix/graph-generator.nix");
  const nodePlanner = await readRepoFile("build-tools/tools/nix/planner/node.nix");
  const nodeWebapp = await readRepoFile("build-tools/tools/nix/planner/node-webapp.nix");

  assert.match(packages, /repoRoot viberootsRoot nixpkgsRegistry/);
  assert.match(graphPackage, /viberootsRoot/);
  assert.match(graphGenerator, /viberootsRoot \? null/);
  assert.match(graphGenerator, /viberootsRoot = viberootsRoot;/);
  assert.match(nodePlanner, /viberootsRoot = ctx\.viberootsRoot or null/);
  assert.match(nodeWebapp, /if viberootsRoot != null/);
  assert.match(nodeWebapp, /then viberootsRoot/);
});

test("d static webapp dev prefers direct importer dev entrypoints over pnpm install paths", async () => {
  const source = await readRepoFile("build-tools/tools/dev/run-runnable.ts");
  assert.match(source, /directStaticWebappDevSpec/);
  assert.match(source, /targetHints\.mode === "static"/);
  assert.match(source, /\["zx-wrapper", "scripts\/dev\.ts"\]/);
  assert.match(source, /"node_modules\/vite\/bin\/vite\.js"/);
});
