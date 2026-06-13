#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { runNodeWithZx } from "../lib/node-run";
import { ensureWorkspaceBuckStatePackage } from "../lib/workspace-buck-state";
import { ensureWorkspaceProvidersPackage } from "../lib/workspace-providers-package";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
} from "../lib/workspace-state-paths";

type RunGluePipelineOptions = {
  graphPath?: string;
  outAutoMap?: string;
  outInvalidationReport?: string;
  zxInitPath?: string;
  verbose?: boolean;
  // When true, skip calling build-tools/tools/buck/sync-providers.ts. This is used when a caller
  // already performed provider sync and only wants the shared downstream glue steps.
  skipProviderSync?: boolean;
  // Control provider index emission: skip entirely, best-effort (ignore failures), or required.
  providerIndex?: "skip" | "best-effort" | "required";
  // Control auto_map emission: skip entirely or required.
  autoMap?: "skip" | "required";
  // Control invalidation-report emission: skip entirely or required.
  invalidationReport?: "skip" | "required";
};

function repoRootFromCwd(): string {
  return process.cwd();
}

function zxInitDefault(repoRoot: string): string {
  return path.join(repoRoot, "build-tools/tools/dev/zx-init.mjs");
}

export async function runGluePipeline(opts: RunGluePipelineOptions = {}): Promise<void> {
  const nodeBin = process.execPath || "node";
  const repoRoot = repoRootFromCwd();
  const zxInit = opts.zxInitPath || zxInitDefault(repoRoot);
  const graphPath = opts.graphPath || DEFAULT_GRAPH_PATH;
  const outAutoMap = opts.outAutoMap || DEFAULT_AUTO_MAP_PATH;
  const outInvalidationReport = opts.outInvalidationReport || DEFAULT_INVALIDATION_REPORT_PATH;
  const verbose = !!opts.verbose;
  const skipProviderSync = !!opts.skipProviderSync;
  const providerIndexMode = opts.providerIndex || "required";
  const autoMapMode = opts.autoMap || "required";
  const invalidationReportMode = opts.invalidationReport || "required";

  await ensureWorkspaceBuckStatePackage(repoRoot);
  await ensureWorkspaceProvidersPackage(repoRoot);

  // Step 0: ensure importer roots Starlark view is up-to-date (deterministic, idempotent)
  {
    const genImporterRoots = path.join(repoRoot, "build-tools/tools/dev/gen-importer-roots-bzl.ts");
    if (verbose) console.error("[glue-pipeline] gen-importer-roots");
    await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: genImporterRoots });
  }

  // Step 1: ensure graph exists (idempotent)
  if (verbose) console.error(`[glue-pipeline] ensureGraph → ${graphPath}`);
  {
    const mod = await import("../patch/glue");
    await mod.ensureGraph();
  }

  // Step 2: sync providers (all languages; language drivers are no-ops when inactive)
  if (!skipProviderSync) {
    const syncScript = path.join(repoRoot, "build-tools/tools/buck/sync-providers.ts");
    if (verbose) console.error("[glue-pipeline] sync-providers");
    await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: syncScript });
  } else if (verbose) {
    console.error("[glue-pipeline] sync-providers (skipped)");
  }

  // Step 3: generate provider index for diagnostics and mapping visibility
  if (providerIndexMode !== "skip") {
    const providerIndexScript = path.join(repoRoot, "build-tools/tools/buck/gen-provider-index.ts");
    if (verbose) console.error("[glue-pipeline] gen-provider-index");
    try {
      await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: providerIndexScript });
    } catch (e) {
      if (providerIndexMode === "required") throw e;
      if (verbose) console.error("[glue-pipeline] gen-provider-index (best-effort):", e);
    }
  } else if (verbose) {
    console.error("[glue-pipeline] gen-provider-index (skipped)");
  }

  // Step 4: generate auto_map deterministically from the graph
  if (autoMapMode !== "skip") {
    const autoMapScript = path.join(repoRoot, "build-tools/tools/buck/gen-auto-map.ts");
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
  } else if (verbose) {
    console.error("[glue-pipeline] gen-auto-map (skipped)");
  }

  // Step 5: generate workspace map for Node deps enforcement
  {
    const workspaceMapScript = path.join(repoRoot, "build-tools/tools/node/gen-workspace-map.ts");
    if (verbose) console.error("[glue-pipeline] gen-workspace-map");
    await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: workspaceMapScript });
  }

  // Step 6: generate invalidation report (diagnostic; stable output)
  if (invalidationReportMode !== "skip") {
    const reportScript = path.join(repoRoot, "build-tools/tools/buck/invalidation-report.ts");
    if (verbose) console.error(`[glue-pipeline] invalidation-report → ${outInvalidationReport}`);
    try {
      await fsp.mkdir(path.dirname(outInvalidationReport), { recursive: true });
    } catch {}
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: reportScript,
      args: ["--graph", graphPath, "--auto-map", outAutoMap, "--out", outInvalidationReport],
    });
  } else if (verbose) {
    console.error("[glue-pipeline] invalidation-report (skipped)");
  }
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
