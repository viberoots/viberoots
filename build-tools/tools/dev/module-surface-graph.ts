#!/usr/bin/env zx-wrapper
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { readGraph, type GraphNode } from "../lib/graph";
import { runNodeWithZx } from "../lib/node-run";

type SurfaceGraphData = {
  tsRoots: string[];
  wasmRoots: string[];
  appLabels: string[];
};

function toArr(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function normalizeLabel(value: string): string {
  let out = String(value || "").trim();
  if (!out) return "";
  out = out.replace(/^root\/\//, "//");
  const configIdx = out.indexOf(" (config//");
  if (configIdx > 0) out = out.slice(0, configIdx);
  return out;
}

function packageOf(label: string): string {
  const idx = label.indexOf(":");
  return idx > 0 ? label.slice(0, idx) : label;
}

function isModuleSurface(node: GraphNode): boolean {
  return String(node.rule_type || node["buck.type"] || "").trim() === "module_surface";
}

function rootsFromSurface(node: GraphNode): { ts: string[]; wasm: string[] } {
  const kind = String(node.module_kind || "").trim();
  const roots = toArr(node.source_roots);
  if (kind === "ts") return { ts: roots, wasm: [] };
  if (kind === "wasm") return { ts: [], wasm: roots };
  return { ts: [], wasm: [] };
}

async function loadGraphNodes(repoRoot: string): Promise<GraphNode[]> {
  const graphPath = path.join(repoRoot, DEFAULT_GRAPH_PATH);
  return await readGraph(graphPath).catch(() => []);
}

async function refreshGraph(repoRoot: string): Promise<void> {
  const exportScript = path.join(repoRoot, "build-tools", "tools", "buck", "export-graph.ts");
  const outPath = path.join(repoRoot, DEFAULT_GRAPH_PATH);
  const zxInitPath = path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  try {
    await runNodeWithZx({
      script: exportScript,
      args: ["--out", outPath],
      zxInitPath,
      nodeBin: process.execPath,
      stdio: "pipe",
      timeoutMs: 5 * 60 * 1000,
      cwd: repoRoot,
      env: process.env,
    });
  } catch (error) {
    const reason =
      error instanceof Error && String(error.message || "").trim()
        ? ` reason=${error.message}`
        : "";
    throw new Error(
      `[module-contracts:E_SURFACE_GRAPH_REFRESH] failed to refresh graph via node+zx${reason}`,
    );
  }
}

function collectSurfaceData(nodes: GraphNode[], appTargetLabel: string): SurfaceGraphData | null {
  if (nodes.length === 0) return null;
  const byName = new Map<string, GraphNode>();
  for (const node of nodes) {
    const name = normalizeLabel(String(node.name || ""));
    if (name) byName.set(name, node);
  }

  const appLabel = normalizeLabel(appTargetLabel);
  const appNode = byName.get(appLabel);
  if (!appNode) return null;
  const appPkg = packageOf(appLabel);

  const surfaceNames = new Set<string>();
  for (const dep of toArr(appNode.deps)) {
    const depLabel = normalizeLabel(dep);
    const depNode = byName.get(depLabel);
    if (depNode && isModuleSurface(depNode)) surfaceNames.add(depLabel);
  }
  for (const [name, node] of byName.entries()) {
    if (!name.startsWith(`${appPkg}:`)) continue;
    if (isModuleSurface(node)) surfaceNames.add(name);
  }

  const tsRoots = new Set<string>();
  const wasmRoots = new Set<string>();
  for (const name of surfaceNames) {
    const node = byName.get(name);
    if (!node) continue;
    const roots = rootsFromSurface(node);
    for (const root of roots.ts) tsRoots.add(root);
    for (const root of roots.wasm) wasmRoots.add(root);
  }
  const appLabels = toArr(appNode.labels);
  // Zero-wasm templates may omit explicit wasm surface roots. Keep discovery provider-driven
  // by deriving canonical roots from app labels rather than parsing TARGETS text.
  if (wasmRoots.size === 0) {
    if (appLabels.includes("framework:next")) wasmRoots.add("app/wasm-producer");
    else wasmRoots.add("src/wasm-producer");
  }
  if (tsRoots.size === 0 && wasmRoots.size === 0) return null;
  return {
    tsRoots: Array.from(tsRoots).sort((a, b) => a.localeCompare(b)),
    wasmRoots: Array.from(wasmRoots).sort((a, b) => a.localeCompare(b)),
    appLabels,
  };
}

export async function moduleSurfaceRootsFromGraph(args: {
  repoRoot: string;
  appTargetLabel: string;
}): Promise<SurfaceGraphData | null> {
  const first = collectSurfaceData(await loadGraphNodes(args.repoRoot), args.appTargetLabel);
  if (first) return first;
  await refreshGraph(args.repoRoot);
  return collectSurfaceData(await loadGraphNodes(args.repoRoot), args.appTargetLabel);
}
