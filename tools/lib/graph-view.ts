import fs from "fs-extra";
import path from "node:path";
import { readGraph, type GraphNode } from "./graph.ts";

export type ProviderIndexEntry = { kind: string; key: string };

export type CompositeGraphView = {
  nodes: GraphNode[];
  providerIndex: Record<string, ProviderIndexEntry>;
  nodeLockIndex: Record<string, string>;
};

export type ReadCompositeGraphOptions = {
  graphPath?: string;
  providerIndexPath?: string;
  nodeLockIndexPath?: string;
};

async function readJsonIfExists<T = any>(p: string): Promise<T | {}> {
  try {
    const exists = await fs.pathExists(p);
    if (!exists) return {} as T;
    return (await fs.readJson(p)) as T;
  } catch {
    return {} as T;
  }
}

export async function readCompositeGraph(
  opts: ReadCompositeGraphOptions = {},
): Promise<CompositeGraphView> {
  const graphPath = opts.graphPath || path.resolve("tools/buck/graph.json");
  const providerIndexPath =
    opts.providerIndexPath || path.resolve("third_party/providers/provider_index.json");
  const nodeLockIndexPath =
    opts.nodeLockIndexPath || path.resolve("tools/buck/node-lock-index.json");

  const nodes = await readGraph(graphPath);
  const providerIndex = (await readJsonIfExists<Record<string, ProviderIndexEntry>>(
    providerIndexPath,
  )) as Record<string, ProviderIndexEntry>;
  const nodeLockRaw = (await readJsonIfExists<Record<string, any>>(nodeLockIndexPath)) as Record<
    string,
    any
  >;
  const nodeLockIndex =
    nodeLockRaw && typeof nodeLockRaw === "object" && nodeLockRaw.index
      ? (nodeLockRaw.index as Record<string, string>)
      : (nodeLockRaw as unknown as Record<string, string>);

  return { nodes, providerIndex, nodeLockIndex };
}
