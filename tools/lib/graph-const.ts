#!/usr/bin/env zx-wrapper
import path from "node:path";
// Use a relative path so callers resolve against their intended workspace root at call time.
export const DEFAULT_GRAPH_PATH = path.join("tools", "buck", "graph.json");
