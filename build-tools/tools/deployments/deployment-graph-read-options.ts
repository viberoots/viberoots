#!/usr/bin/env zx-wrapper
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import type { ReadCompositeGraphOptions } from "../lib/graph-view";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
} from "../lib/workspace-state-paths";

export function deploymentGraphReadOptions(
  workspaceRoot: string,
  graphPath = DEFAULT_GRAPH_PATH,
): ReadCompositeGraphOptions {
  const selectedGraphPath = graphPath.trim() || DEFAULT_GRAPH_PATH;
  return {
    graphPath: resolveWorkspacePath(workspaceRoot, selectedGraphPath),
    providerIndexPath: path.join(workspaceRoot, DEFAULT_PROVIDER_INDEX_JSON_PATH),
    nodeLockIndexPath: path.join(workspaceRoot, DEFAULT_NODE_LOCK_INDEX_PATH),
  };
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(workspaceRoot, value);
}
