#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getFlagBool } from "../lib/cli";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { runNodeWithZx } from "../lib/node-run";
import { ensureWorkspaceBuckStatePackage } from "../lib/workspace-buck-state";
import { ensureWorkspaceProvidersPackage } from "../lib/workspace-providers-package";
import { buildToolPath, zxInitPath } from "../dev/dev-build/paths";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
} from "../lib/workspace-state-paths";
import { writeGlueFingerprint } from "../dev/install/glue-freshness";
import { handoffChangedGlobalInputConsumers } from "../dev/buck-global-input-handoff";

type RunGluePipelineOptions = {
  forceGraph?: boolean;
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
  workspaceRoot?: string;
  toolSourceRoot?: string;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  buck2Bin?: string;
  nixBin?: string;
  publishFingerprint?: boolean;
};

function repoRootFromCwd(): string {
  return process.cwd();
}

function executingToolSourceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export async function runGluePipeline(opts: RunGluePipelineOptions = {}): Promise<void> {
  const nodeBin = opts.nodeBin || process.execPath || "node";
  const repoRoot = opts.workspaceRoot || repoRootFromCwd();
  const toolSourceRoot = opts.toolSourceRoot || executingToolSourceRoot();
  const env = opts.env || process.env;
  const zxInit = opts.zxInitPath || zxInitPath(toolSourceRoot);
  const graphPath = path.resolve(repoRoot, opts.graphPath || DEFAULT_GRAPH_PATH);
  const outAutoMap = path.resolve(repoRoot, opts.outAutoMap || DEFAULT_AUTO_MAP_PATH);
  const outInvalidationReport = path.resolve(
    repoRoot,
    opts.outInvalidationReport || DEFAULT_INVALIDATION_REPORT_PATH,
  );
  const verbose = !!opts.verbose;
  const skipProviderSync = !!opts.skipProviderSync;
  const providerIndexMode = opts.providerIndex || "required";
  const autoMapMode = opts.autoMap || "required";
  const invalidationReportMode = opts.invalidationReport || "required";

  await ensureWorkspaceBuckStatePackage(repoRoot);
  await ensureWorkspaceProvidersPackage(repoRoot);

  const refreshGraph = async (force: boolean): Promise<void> => {
    const mod = await import("../patch/glue");
    await mod.reconcileGeneratedGraph({
      workspaceRoot: repoRoot,
      target: env.BUCK_TARGET || "",
      graphPath,
      env,
      nodeBin,
      buck2Bin: opts.buck2Bin,
      nixBin: opts.nixBin,
      toolSourceRoot,
      force,
    });
    await ensureWorkspaceBuckStatePackage(repoRoot);
  };

  // Step 0: ensure importer roots Starlark view is up-to-date (deterministic, idempotent)
  {
    const genImporterRoots = buildToolPath(toolSourceRoot, "tools/dev/gen-importer-roots-bzl.ts");
    if (verbose) console.error("[glue-pipeline] gen-importer-roots");
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: genImporterRoots,
      cwd: repoRoot,
      env,
    });
  }

  // Step 1: ensure graph exists (idempotent)
  if (verbose) console.error(`[glue-pipeline] reconcile graph → ${graphPath}`);
  await refreshGraph(!!opts.forceGraph);

  // Step 2: sync providers (all languages; language drivers are no-ops when inactive)
  if (!skipProviderSync) {
    const syncScript = buildToolPath(toolSourceRoot, "tools/buck/sync-providers.ts");
    if (verbose) console.error("[glue-pipeline] sync-providers");
    await runNodeWithZx({ nodeBin, zxInitPath: zxInit, script: syncScript, cwd: repoRoot, env });
    if (opts.forceGraph) await handoffChangedGlobalInputConsumers(repoRoot, env);
  } else if (verbose) {
    console.error("[glue-pipeline] sync-providers (skipped)");
  }

  // Step 3: generate provider index for diagnostics and mapping visibility
  if (providerIndexMode !== "skip") {
    const providerIndexScript = buildToolPath(toolSourceRoot, "tools/buck/gen-provider-index.ts");
    if (verbose) console.error("[glue-pipeline] gen-provider-index");
    try {
      await runNodeWithZx({
        nodeBin,
        zxInitPath: zxInit,
        script: providerIndexScript,
        cwd: repoRoot,
        env,
      });
    } catch (e) {
      if (providerIndexMode === "required") throw e;
      if (verbose) console.error("[glue-pipeline] gen-provider-index (best-effort):", e);
    }
  } else if (verbose) {
    console.error("[glue-pipeline] gen-provider-index (skipped)");
  }

  // Step 4: generate auto_map deterministically from the graph
  if (autoMapMode !== "skip") {
    const autoMapScript = buildToolPath(toolSourceRoot, "tools/buck/gen-auto-map.ts");
    if (verbose) console.error(`[glue-pipeline] gen-auto-map → ${outAutoMap}`);
    // Ensure output directory exists to avoid noisy errors in temp repos
    try {
      await mkdirWithMacosMetadataExclusion(path.dirname(outAutoMap));
    } catch {}
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: autoMapScript,
      args: ["--graph", graphPath, "--out", outAutoMap],
      cwd: repoRoot,
      env,
    });
  } else if (verbose) {
    console.error("[glue-pipeline] gen-auto-map (skipped)");
  }

  // A forced reconciliation must publish the graph produced by the newly
  // generated provider mapping, not the pre-mapping graph used to create it.
  if (opts.forceGraph && autoMapMode !== "skip") {
    if (verbose) console.error(`[glue-pipeline] reconcile graph after auto-map → ${graphPath}`);
    await refreshGraph(true);
  }

  // Step 5: generate workspace map for Node deps enforcement
  {
    const workspaceMapScript = buildToolPath(toolSourceRoot, "tools/node/gen-workspace-map.ts");
    if (verbose) console.error("[glue-pipeline] gen-workspace-map");
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: workspaceMapScript,
      cwd: repoRoot,
      env,
    });
  }

  // Step 6: generate invalidation report (diagnostic; stable output)
  if (invalidationReportMode !== "skip") {
    const reportScript = buildToolPath(toolSourceRoot, "tools/buck/invalidation-report.ts");
    if (verbose) console.error(`[glue-pipeline] invalidation-report → ${outInvalidationReport}`);
    try {
      await mkdirWithMacosMetadataExclusion(path.dirname(outInvalidationReport));
    } catch {}
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: reportScript,
      args: ["--graph", graphPath, "--auto-map", outAutoMap, "--out", outInvalidationReport],
      cwd: repoRoot,
      env,
    });
  } else if (verbose) {
    console.error("[glue-pipeline] invalidation-report (skipped)");
  }

  if (opts.publishFingerprint !== false) await writeGlueFingerprint(repoRoot);
}

async function main() {
  await runGluePipeline({
    forceGraph: getFlagBool("force-graph"),
    publishFingerprint: !getFlagBool("defer-fingerprint"),
  });
}

export async function isGluePipelineEntrypoint(
  argvPath = process.argv[1] || "",
  moduleUrl = import.meta.url,
): Promise<boolean> {
  if (!argvPath) return false;
  if (moduleUrl === pathToFileURL(path.resolve(argvPath)).href) return true;
  try {
    const [modulePath, canonicalArgvPath] = await Promise.all([
      fsp.realpath(fileURLToPath(moduleUrl)),
      fsp.realpath(argvPath),
    ]);
    return modulePath === canonicalArgvPath;
  } catch {
    return false;
  }
}

if (getFlagBool("run-pipeline") || (await isGluePipelineEntrypoint())) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
