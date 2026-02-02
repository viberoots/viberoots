#!/usr/bin/env zx-wrapper
import type { Adapter, Node } from "../types.ts";
import { classificationRegistryEntry } from "./classification-registry.ts";
import { hasLabel, isRuleType } from "./helpers.ts";
import { buildImporterScopedAdapter } from "./importer-scoped-adapter.ts";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

const importerScopedConfig = importerScopedAdapterRegistryEntry("python");

export const adapter: Adapter = buildImporterScopedAdapter({
  name: "python",
  isTarget: isPythonTarget,
  importerScopedConfig,
  classification: classificationRegistryEntry("python"),
});

export default adapter;
