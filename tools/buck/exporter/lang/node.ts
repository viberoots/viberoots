#!/usr/bin/env zx-wrapper
import type { Adapter, Node } from "../types.ts";
import { classificationRegistryEntry } from "./classification-registry.ts";
import { hasLabel, isRuleType } from "./helpers.ts";
import { buildImporterScopedAdapter } from "./importer-scoped-adapter.ts";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";

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
