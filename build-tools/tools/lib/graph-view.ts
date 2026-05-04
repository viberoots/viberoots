import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readGraph, type GraphNode } from "./graph";
import { DEFAULT_GRAPH_PATH } from "./graph-const";

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
    await fsp.access(p).catch(() => {
      throw new Error("ENOENT");
    });
    const txt = await fsp.readFile(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return {} as T;
  }
}

export async function readCompositeGraph(
  opts: ReadCompositeGraphOptions = {},
): Promise<CompositeGraphView> {
  const graphPath = opts.graphPath || DEFAULT_GRAPH_PATH;
  const providerIndexPath =
    opts.providerIndexPath || path.resolve("third_party/providers/provider_index.json");
  const nodeLockIndexPath =
    opts.nodeLockIndexPath || path.resolve("build-tools/tools/buck/node-lock-index.json");

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
