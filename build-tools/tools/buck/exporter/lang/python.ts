#!/usr/bin/env zx-wrapper
import type { Adapter, Node } from "../types";
import { classificationRegistryEntry } from "./classification-registry";
import { hasLabel, isRuleType } from "./helpers";
import { buildImporterScopedAdapter } from "./importer-scoped-adapter";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry";

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
