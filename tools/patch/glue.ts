#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function runNode(nodeBin: string, zxInit: string, script: string, args: string[] = []) {
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
    script,
    ...args,
  ];
  await new Promise<void>((resolve, reject) => {
    execFile(nodeBin, zxArgs, { stdio: "inherit" }, (err) => (err ? reject(err) : resolve()));
  });
}

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
  try {
    await runNode(nodeBin, zxInit, exportScript, ["--out", "tools/buck/graph.json"]);
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
  const providerIndexScript = path.join(repoRoot, "tools/buck/gen-provider-index.ts");
  const autoMapScript = path.join(repoRoot, "tools/buck/gen-auto-map.ts");
  await runNode(nodeBin, zxInit, syncScript);
  // Emit provider index for diagnostics and mapping visibility before auto_map
  await runNode(nodeBin, zxInit, providerIndexScript);
  await runNode(nodeBin, zxInit, autoMapScript, [
    "--graph",
    "tools/buck/graph.json",
    "--out",
    "third_party/providers/auto_map.bzl",
  ]);
}
