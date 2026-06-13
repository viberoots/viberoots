#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exportInlineGraph } from "../buck/export-inline";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { getImporterRootsContract } from "../lib/importer-roots";
import { normalizeTargetLabel } from "../lib/labels";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot } from "../lib/repo";
import { ensureWorkspaceBuckStatePackage } from "../lib/workspace-buck-state";
import { DEFAULT_AUTO_MAP_PATH } from "../lib/workspace-state-paths";

async function buck2Present(): Promise<boolean> {
  try {
    const res = await $({ stdio: "pipe" })`buck2 --version`.nothrow();
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

// ensureGraph: writes build-tools/tools/buck/graph.json if missing by invoking the exporter
function parseGraphNodes(txt: string): any[] {
  const data = JSON.parse(txt);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).nodes)) return (data as any).nodes;
  return [];
}

function graphContainsTarget(txt: string, wantTargetRaw: string): boolean {
  const want = String(wantTargetRaw || "").trim();
  if (!want) return true;
  const normWant = normalizeTargetLabel(want);
  const nodes = parseGraphNodes(txt);
  return nodes.some(
    (n: any) => typeof n?.name === "string" && normalizeTargetLabel(n.name) === normWant,
  );
}

export async function ensureGraph(
  opts: {
    exportGraph?: () => Promise<void>;
    workspaceRoot?: string;
    target?: string;
    queryRoots?: string[];
  } = {},
): Promise<void> {
  const workspaceRoot = (
    opts.workspaceRoot ||
    process.env.WORKSPACE_ROOT ||
    process.env.BUCK_TEST_SRC ||
    process.cwd()
  ).trim();
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  const forceInline = String(process.env.EXPORTER_FORCE_INLINE || "").trim() === "1";
  async function isValidJsonFile(p: string): Promise<boolean> {
    try {
      const txt = await fsp.readFile(p, "utf8");
      const trimmed = String(txt || "").trim();
      if (!trimmed || trimmed === "[]") return false;
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  try {
    console.error(`[ensureGraph] workspaceRoot=${workspaceRoot}`);
  } catch {}
  await ensureWorkspaceBuckStatePackage(workspaceRoot);
  const wantTargetRaw = (opts.target || process.env.BUCK_TARGET || "").trim();
  const shouldRegenerate = async (): Promise<boolean> => {
    try {
      const txt = await fsp.readFile(graphPath, "utf8");
      const trimmed = String(txt || "").trim();
      if (!trimmed || trimmed === "[]") return true;
      // If the file exists but is not valid JSON (e.g. tests may "touch" it with a comment),
      // treat it as missing so we regenerate a well-formed graph for downstream consumers.
      try {
        JSON.parse(trimmed);
      } catch {
        return true;
      }
      if (!wantTargetRaw) return false;
      try {
        return !graphContainsTarget(trimmed, wantTargetRaw);
      } catch {
        return true;
      }
    } catch {
      return true;
    }
  };

  if (!(await shouldRegenerate())) {
    try {
      console.error(`[ensureGraph] graph exists and satisfies BUCK_TARGET: ${graphPath}`);
    } catch {}
    return;
  }

  if (wantTargetRaw) {
    try {
      console.error(
        `[ensureGraph] target ${wantTargetRaw} missing in existing graph — regenerating`,
      );
    } catch {}
  }

  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  try {
    await fsp.access(graphPath);
  } catch {
    // Buck queries may need //build-tools/tools/buck:graph.json to exist as a
    // declared source before the exporter can regenerate its real contents.
    await fsp.writeFile(graphPath, "[]\n", "utf8");
  }

  const tryInjected = async (): Promise<boolean> => {
    if (!opts.exportGraph) return false;
    try {
      await opts.exportGraph();
      return await isValidJsonFile(graphPath);
    } catch {
      return false;
    }
  };
  if (await tryInjected()) return;

  const nodeBin = process.execPath;
  const repoRoot =
    (process.env.REPO_ROOT && process.env.REPO_ROOT.trim()) || (await findRepoRoot(process.cwd()));
  const zxInit = path.join(repoRoot, "build-tools/tools/dev/zx-init.mjs");
  const exportScript = path.join(repoRoot, "build-tools/tools/buck/export-graph.ts");
  const exporterArgs = ["--out", graphPath];

  const exportWithInline = async (inlineOpts: {
    includeTargetPlatforms: boolean;
    normalizeLabels: boolean;
    target: string;
  }) => {
    try {
      console.error(`[ensureGraph] inline export via buck2 → ${graphPath}`);
    } catch {}
    const importerRoots = getImporterRootsContract().workspaceRoots;
    const defaultRoots = Array.from(new Set([...importerRoots, "go", "cpp", "third_party"]));
    const rawRoots = (
      opts.queryRoots?.join(",") ||
      process.env.BUCK_QUERY_ROOTS ||
      defaultRoots.join(",")
    )
      .split(/[,\s]+/)
      .filter(Boolean);
    const fs = await import("node:fs");
    const existingRoots = rawRoots.filter((r: string) => {
      const dir = r.replace(/^\/+/, "");
      try {
        return fs.existsSync(path.join(workspaceRoot, dir));
      } catch {
        return false;
      }
    });
    await exportInlineGraph({
      workspaceRoot,
      outPath: graphPath,
      target: inlineOpts.target,
      roots: existingRoots.length > 0 ? existingRoots : ["libs"],
      includeTargetPlatforms: inlineOpts.includeTargetPlatforms,
      normalizeLabels: inlineOpts.normalizeLabels,
    });
  };

  const haveBuck = await buck2Present();
  if (forceInline) {
    await exportWithInline({
      includeTargetPlatforms: true,
      normalizeLabels: true,
      target: wantTargetRaw,
    });
    return;
  }

  const passEnv = {
    ...process.env,
    WORKSPACE_ROOT: workspaceRoot,
    BUCK_TEST_SRC: workspaceRoot,
    REPO_ROOT: repoRoot,
    ...(opts.queryRoots?.length ? { BUCK_QUERY_ROOTS: opts.queryRoots.join(",") } : {}),
    ...(wantTargetRaw ? { BUCK_TARGET: wantTargetRaw } : {}),
  } as Record<string, string>;

  if (haveBuck) {
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: exportScript,
      args: exporterArgs,
      cwd: workspaceRoot,
      env: passEnv,
    });
    if (!(await isValidJsonFile(graphPath))) {
      throw new Error(`export-graph produced invalid JSON at ${graphPath}`);
    }
    return;
  }

  // Buck2 is not available; try running via nix (still uses the same exporter script).
  await $({
    env: passEnv,
  })`nix run --accept-flake-config ${repoRoot}#zx-wrapper -- ${exportScript} ${exporterArgs}`;
  await fsp.access(graphPath);
  if (!(await isValidJsonFile(graphPath))) {
    throw new Error(`export-graph produced invalid JSON at ${graphPath}`);
  }
}

// runGlue: sync providers (all languages) then generate auto_map deterministically
export async function runGlue(): Promise<void> {
  // Delegate to the centralized glue pipeline to avoid drift between callsites.
  const { runGluePipeline } = await import("../buck/glue-pipeline");
  await runGluePipeline({
    graphPath: DEFAULT_GRAPH_PATH,
    outAutoMap: DEFAULT_AUTO_MAP_PATH,
  });
}
