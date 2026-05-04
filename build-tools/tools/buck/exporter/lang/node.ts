#!/usr/bin/env zx-wrapper
import type { Adapter, Node } from "../types";
import { classificationRegistryEntry } from "./classification-registry";
import { hasLabel, isRuleType } from "./helpers";
import { buildImporterScopedAdapter } from "./importer-scoped-adapter";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

const importerScopedConfig = importerScopedAdapterRegistryEntry("node");

export const adapter: Adapter = buildImporterScopedAdapter({
  name: "node",
  isTarget: isNodeTarget,
  importerScopedConfig,
  classification: classificationRegistryEntry("node"),
});

export default adapter;
