#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { findNearestUvLockForPackage } from "../../../lib/importers.ts";
import { lockfileLabels } from "./importer-lockfile-labels.ts";
import {
  attachImporterScopedLockfileLabels,
  validateImporterScopedAdapter,
} from "./importer-scoped-adapter.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

export const adapter: Adapter = {
  name: "python",
  isNode(n) {
    return isPythonTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    out.push(
      ...(await validateImporterScopedAdapter(nodes, {
        adapterName: "python",
        lockfileBasename: "uv.lock",
        isTarget: isPythonTarget,
        findNearestLockfile: findNearestUvLockForPackage,
        shouldWarnMissingKindLabel(n) {
          return lockfileLabels(n).length > 0;
        },
      })),
    );

    // Warn-only: .py sources missing both python_* rule_type and lang:python label
    out.push(
      ...validateLanguageClassification(nodes, {
        name: "python",
        looksLike(n: Node) {
          const srcs = Array.isArray((n as any).srcs) ? ((n as any).srcs as string[]) : [];
          return srcs.some((s) => /\.py$/i.test(s));
        },
        hasRuleType(n: Node) {
          return isRuleType(n, "python_");
        },
        hasLangLabel(n: Node) {
          return hasLabel(n, "lang:python");
        },
        ruleTypePrefix: "python_*",
        langLabel: "lang:python",
        subject: "Python-looking sources",
        guidance:
          "Guidance: stamp 'lang:python' via macros or use python_* rules to classify Python targets.",
      }),
    );
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Python adapter does not need external batching/queries.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    return attachImporterScopedLockfileLabels({
      nodes,
      adapterName: "python",
      lockfileBasename: "uv.lock",
      isTarget: isPythonTarget,
      findNearestLockfile: findNearestUvLockForPackage,
    });
  },
};

export default adapter;
