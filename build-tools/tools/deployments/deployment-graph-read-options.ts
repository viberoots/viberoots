#!/usr/bin/env zx-wrapper
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import type { ReadCompositeGraphOptions } from "../lib/graph-view";

export function deploymentGraphReadOptions(
  workspaceRoot: string,
  graphPath = DEFAULT_GRAPH_PATH,
): ReadCompositeGraphOptions {
  const selectedGraphPath = graphPath.trim() || DEFAULT_GRAPH_PATH;
  return {
    graphPath: resolveWorkspacePath(workspaceRoot, selectedGraphPath),
    providerIndexPath: path.join(workspaceRoot, "third_party/providers/provider_index.json"),
    nodeLockIndexPath: path.join(workspaceRoot, "build-tools/tools/buck/node-lock-index.json"),
  };
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(workspaceRoot, value);
}
