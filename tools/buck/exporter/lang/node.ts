#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { classificationRegistryEntry } from "./classification-registry.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import {
  attachImporterScopedLockfileLabels,
  validateImporterScopedAdapter,
} from "./importer-scoped-adapter.ts";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

const importerScopedConfig = importerScopedAdapterRegistryEntry("node");

export const adapter: Adapter = {
  name: "node",
  isNode(n) {
    return isNodeTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    out.push(
      ...(await validateImporterScopedAdapter(nodes, {
        adapterName: "node",
        lockfileBasename: importerScopedConfig.lockfileBasename,
        isTarget: isNodeTarget,
        findNearestLockfile: importerScopedConfig.findNearestLockfile,
        shouldWarnMissingKindLabel: importerScopedConfig.shouldWarnMissingKindLabel,
      })),
    );

    // PR-5: advisory for missing lang:node using shared classification helper.
    // Narrow scope: only consider nodes that appear macro-stamped (have importer-scoped lockfile label).
    out.push(...validateLanguageClassification(nodes, classificationRegistryEntry("node")));
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Node adapter does not batch external queries; label pass-through only.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    return attachImporterScopedLockfileLabels({
      nodes,
      adapterName: "node",
      lockfileBasename: importerScopedConfig.lockfileBasename,
      isTarget: isNodeTarget,
      findNearestLockfile: importerScopedConfig.findNearestLockfile,
    });
  },
};

export default adapter;
