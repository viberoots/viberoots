#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

// ensureGraph: writes tools/buck/graph.json if missing by invoking the exporter
export async function ensureGraph(): Promise<void> {
  try {
    await fsp.access("tools/buck/graph.json");
    return;
  } catch {}
  const nodeBin = process.execPath;
  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const exportScript = path.join(repoRoot, "tools/buck/export-graph.ts");
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
  ];
  try {
    await $`${nodeBin} ${zxArgs} ${exportScript} --out tools/buck/graph.json`;
  } catch (e) {
    throw new Error(
      "tools/buck/graph.json is missing and exporter failed. Ensure buck2 is available in the dev shell and run: tools/buck/export-graph.ts",
    );
  }
}

// runGlue: sync providers (all languages) then generate auto_map deterministically
export async function runGlue(): Promise<void> {
  await ensureGraph();
  const nodeBin = process.execPath;
  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const syncScript = path.join(repoRoot, "tools/buck/sync-providers.ts");
  const autoMapScript = path.join(repoRoot, "tools/buck/gen-auto-map.ts");
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
  ];
  await $`${nodeBin} ${zxArgs} ${syncScript}`;
  await $`${nodeBin} ${zxArgs} ${autoMapScript} --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
}
