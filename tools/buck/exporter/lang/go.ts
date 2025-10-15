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
    // or carry a 'lang:go' label stamped by macros. Return findings, do not throw.
    const findings: string[] = [];
    const offenders: string[] = [];
    for (const n of nodes) {
      const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
      const looksGo = srcs.some((s) => s.endsWith(".go"));
      const hasGoRT = (n.rule_type || "").startsWith("go_");
      const hasLangGo = (n.labels || []).includes("lang:go");
      if (looksGo && !hasGoRT && !hasLangGo) offenders.push(n.name);
    }
    if (offenders.length) {
      const sample = offenders.slice(0, 10).join("\n  - ");
      findings.push(
        [
          "[exporter][go] targets include .go sources but lack both go_* rule_type and 'lang:go' label:",
          `  - ${sample}`,
          offenders.length > 10 ? `  ... and ${offenders.length - 10} more` : "",
          "Fix: ensure macros stamp 'lang:go' (and 'kind:bin') or use go_* rules.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return findings;
  },
  async buildBatches(nodes: Node[]): Promise<Batch[]> {
    return buildBatches(nodes);
  },
  async attachLabels(nodes, batches, cacheDir) {
    return attachGoModuleLabels(nodes, batches, cacheDir);
  },
};
