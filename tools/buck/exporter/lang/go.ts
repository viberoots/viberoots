#!/usr/bin/env zx-wrapper
import { buildBatches, isGoNode } from "../batch.ts";
import { attachGoModuleLabels } from "../labeler.ts";
import type { Adapter, Batch, GoListByBatch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";

export const goAdapter: Adapter = {
  name: "go",
  isNode(n: Node): boolean {
    return isGoNode(n);
  },
  validate(nodes: Node[]) {
    return validateLanguageClassification(nodes, {
      name: "go",
      looksLike(n: Node) {
        const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
        return srcs.some((s) => s.endsWith(".go"));
      },
      hasRuleType(n: Node) {
        return isRuleType(n, "go_");
      },
      hasLangLabel(n: Node) {
        return hasLabel(n, "lang:go");
      },
      ruleTypePrefix: "go_*",
      langLabel: "lang:go",
      subject: ".go sources",
      guidance: "Fix: ensure macros stamp 'lang:go' (and 'kind:bin') or use go_* rules.",
    });
  },
  async buildBatches(nodes: Node[]): Promise<Batch[]> {
    return buildBatches(nodes);
  },
  async attachLabels(nodes, batches, _cacheDir, goListByBatch?: GoListByBatch) {
    return attachGoModuleLabels(nodes, batches, goListByBatch);
  },
};
