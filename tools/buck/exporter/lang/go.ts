#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "../batch.ts";
import { attachGoModuleLabels } from "../labeler.ts";
import type { Adapter, Batch, Node } from "../types.ts";

export const goAdapter: Adapter = {
  name: "go",
  isNode(n: Node): boolean {
    return isGoNode(n);
  },
  async buildBatches(nodes: Node[]): Promise<Batch[]> {
    return buildBatches(nodes);
  },
  async attachLabels(nodes, batches, cacheDir) {
    return attachGoModuleLabels(nodes, batches, cacheDir);
  },
};
