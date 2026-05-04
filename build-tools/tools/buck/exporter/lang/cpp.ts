#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types";
import { classificationRegistryEntry } from "./classification-registry";
import { validateLanguageClassification } from "./helpers";

function isCppNode(n: Node): boolean {
  if ((n.rule_type || "").startsWith("cxx_")) return true;
  const labs = n.labels || [];
  return labs.includes("lang:cpp");
}

function kindFromRuleType(rt: string): string | null {
  if (rt === "cxx_binary") return "kind:bin";
  if (rt === "cxx_library") return "kind:lib";
  if (rt === "cxx_test") return "kind:test";
  return null;
}

export const adapter: Adapter = {
  name: "cpp",
  isNode(n) {
    return isCppNode(n);
  },
  // Warn-only validation: return advisory messages; main driver decides severity.
  validate(nodes: Node[]) {
    return validateLanguageClassification(nodes, classificationRegistryEntry("cpp"));
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    return [];
  },
  async attachLabels(nodes) {
    return nodes.map((n) => {
      if (!isCppNode(n)) return n;
      const set = new Set<string>(n.labels || []);
      set.add("lang:cpp");
      const k = kindFromRuleType(n.rule_type || "");
      if (k) set.add(k);
      return { ...n, labels: Array.from(set).sort() };
    });
  },
};

export default adapter;
