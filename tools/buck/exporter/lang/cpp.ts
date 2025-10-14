#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";

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
  // Warn-only validation: if a node looks like C++ (has .cc/.cpp/.cxx in srcs)
  // but lacks both cxx_* rule_type and 'lang:cpp' label, emit an advisory warning.
  // Do NOT fail the build — this is purely to surface likely misclassification.
  validate(nodes: Node[]) {
    const suspects: string[] = [];
    for (const n of nodes) {
      const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
      const looksCpp = srcs.some((s) => /\.(cc|cpp|cxx)$/i.test(s));
      const hasCxxRule = (n.rule_type || "").startsWith("cxx_");
      const hasLangCpp = (n.labels || []).includes("lang:cpp");
      if (looksCpp && !hasCxxRule && !hasLangCpp) {
        suspects.push(n.name);
      }
    }
    if (suspects.length) {
      const sample = suspects.slice(0, 10).join("\n  - ");
      console.warn(
        [
          "[exporter][cpp] warning: targets include C++-looking sources but lack both cxx_* rule_type and 'lang:cpp' label:",
          `  - ${sample}`,
          suspects.length > 10 ? `  ... and ${suspects.length - 10} more` : "",
          "Guidance: stamp 'lang:cpp' in macros or use cxx_* rules to classify C++ targets.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
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
