#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { classificationRegistryEntry } from "./classification-registry.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import {
  attachImporterScopedLockfileLabels,
  validateImporterScopedAdapter,
} from "./importer-scoped-adapter.ts";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

const importerScopedConfig = importerScopedAdapterRegistryEntry("python");

export const adapter: Adapter = {
  name: "python",
  isNode(n) {
    return isPythonTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    out.push(
      ...(await validateImporterScopedAdapter(nodes, {
        adapterName: "python",
        lockfileBasename: importerScopedConfig.lockfileBasename,
        isTarget: isPythonTarget,
        findNearestLockfile: importerScopedConfig.findNearestLockfile,
        shouldWarnMissingKindLabel: importerScopedConfig.shouldWarnMissingKindLabel,
      })),
    );

    // Warn-only: .py sources missing both python_* rule_type and lang:python label
    out.push(...validateLanguageClassification(nodes, classificationRegistryEntry("python")));
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Python adapter does not need external batching/queries.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    return attachImporterScopedLockfileLabels({
      nodes,
      adapterName: "python",
      lockfileBasename: importerScopedConfig.lockfileBasename,
      isTarget: isPythonTarget,
      findNearestLockfile: importerScopedConfig.findNearestLockfile,
    });
  },
};

export default adapter;
