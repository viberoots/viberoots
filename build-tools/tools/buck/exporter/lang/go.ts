#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "../batch";
import { attachGoModuleLabels } from "../labeler";
import type { Adapter, Batch, GoListByBatch, Node } from "../types";
import { classificationRegistryEntry } from "./classification-registry";
import { validateLanguageClassification } from "./helpers";

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
