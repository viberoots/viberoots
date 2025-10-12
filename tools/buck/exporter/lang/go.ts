#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "../batch.ts";
import { attachGoModuleLabels } from "../labeler.ts";
import type { Adapter, Batch, Node } from "../types.ts";

export const goAdapter: Adapter = {
  name: "go",
  isNode(n: Node): boolean {
    return isGoNode(n);
  },
  validate(nodes: Node[]) {
    // Enforce authoritative classification: .go sources must have either go_* rule_type
    // or carry a 'lang:go' label stamped by macros.
    const bad: string[] = [];
    for (const n of nodes) {
      const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
      const looksGo = srcs.some((s) => s.endsWith(".go"));
      const hasGoRT = (n.rule_type || "").startsWith("go_");
      const hasLangGo = (n.labels || []).includes("lang:go");
      if (looksGo && !hasGoRT && !hasLangGo) bad.push(n.name);
    }
    if (bad.length) {
      const sample = bad.slice(0, 10).join("\n  - ");
      throw new Error(
        [
          "Go adapter validation failed: targets include .go sources but lack both go_* rule_type and 'lang:go' label:",
          `  - ${sample}`,
          bad.length > 10 ? `  ... and ${bad.length - 10} more` : "",
          "Fix: ensure macros stamp 'lang:go' (and 'kind:bin' for binaries) or Buck emits go_* rule_type.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  },
  async buildBatches(nodes: Node[]): Promise<Batch[]> {
    return buildBatches(nodes);
  },
  async attachLabels(nodes, batches, cacheDir) {
    return attachGoModuleLabels(nodes, batches, cacheDir);
  },
};
