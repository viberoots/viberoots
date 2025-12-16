#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { runNodeWithZx } from "../lib/node-run.ts";

type RunGluePipelineOptions = {
  graphPath?: string;
  outAutoMap?: string;
  zxInitPath?: string;
  verbose?: boolean;
};

function repoRootFromCwd(): string {
  return process.cwd();
}

function zxInitDefault(repoRoot: string): string {
  return path.join(repoRoot, "tools/dev/zx-init.mjs");
}

export async function runGluePipeline(opts: RunGluePipelineOptions = {}): Promise<void> {
  const nodeBin = process.execPath || "node";
  const repoRoot = repoRootFromCwd();
  const zxInit = opts.zxInitPath || zxInitDefault(repoRoot);
  const graphPath = opts.graphPath || DEFAULT_GRAPH_PATH;
  const outAutoMap = opts.outAutoMap || "third_party/providers/auto_map.bzl";
  const verbose = !!opts.verbose;

  // Step 1: ensure graph exists (idempotent)
  if (verbose) console.error(`[glue-pipeline] ensureGraph → ${graphPath}`);
  {
    const mod = await import("../patch/glue.ts");
    await mod.ensureGraph();
  }

  // Step 2: sync providers (all languages; language drivers are no-ops when inactive)
  const syncScript = path.join(repoRoot, "tools/buck/sync-providers.ts");
  if (verbose) console.error("[glue-pipeline] sync-providers");
  await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: syncScript });

  // Step 3: generate provider index for diagnostics and mapping visibility
  const providerIndexScript = path.join(repoRoot, "tools/buck/gen-provider-index.ts");
  if (verbose) console.error("[glue-pipeline] gen-provider-index");
  await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: providerIndexScript });

  // Step 4: generate auto_map deterministically from the graph
  const autoMapScript = path.join(repoRoot, "tools/buck/gen-auto-map.ts");
  if (verbose) console.error(`[glue-pipeline] gen-auto-map → ${outAutoMap}`);
  // Ensure output directory exists to avoid noisy errors in temp repos
  try {
    await fsp.mkdir(path.dirname(outAutoMap), { recursive: true });
  } catch {}
  await runNodeWithZx({
    nodeBin,
    zxInitPath: zxInit,
    script: autoMapScript,
    args: ["--graph", graphPath, "--out", outAutoMap],
  });
}

async function main() {
  await runGluePipeline({});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
