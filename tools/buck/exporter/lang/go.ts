#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "../batch.ts";
import { attachGoModuleLabels } from "../labeler.ts";
import type { Adapter, Batch, GoListByBatch, Node } from "../types.ts";
import { classificationRegistryEntry } from "./classification-registry.ts";
import { validateLanguageClassification } from "./helpers.ts";

export const goAdapter: Adapter = {
  name: "go",
  isNode(n: Node): boolean {
    return isGoNode(n);
  },
  validate(nodes: Node[]) {
    return validateLanguageClassification(nodes, classificationRegistryEntry("go"));
  },
  async buildBatches(nodes: Node[]): Promise<Batch[]> {
    return buildBatches(nodes);
  },
  async attachLabels(nodes, batches, _cacheDir, goListByBatch?: GoListByBatch) {
    return attachGoModuleLabels(nodes, batches, goListByBatch);
  },
};
