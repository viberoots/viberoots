#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";
import { computeImporterLabel, findNearestUvLockForPackage } from "../../../lib/importers.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

export const adapter: Adapter = {
  name: "python",
  isNode(n) {
    return isPythonTarget(n);
  },
  validate(nodes: Node[]) {
    // Warn-only: .py sources missing both python_* rule_type and lang:python label
    return validateLanguageClassification(nodes, {
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
    });
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Python adapter does not need external batching/queries.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    const enriched: Node[] = [];
    for (const n of nodes) {
      if (!isPythonTarget(n)) {
        enriched.push(n);
        continue;
      }
      const labs = Array.isArray(n.labels) ? [...n.labels] : [];
      const hasLock = labs.some((l) => typeof l === "string" && l.startsWith("lockfile:"));
      if (hasLock) {
        enriched.push(n);
        continue;
      }
      // Derive importer from Buck package; if uv.lock found, attach importer-scoped label
      const pkg = packageDirFromTargetName(n.name || "") || ".";
      const lockRel = await findNearestUvLockForPackage(pkg);
      if (!lockRel) {
        enriched.push(n);
        continue;
      }
      const importer = computeImporterLabel(lockRel);
      const label = `lockfile:${lockRel}#${importer}`;
      const next = Array.from(new Set([...(labs as string[]), label])).sort();
      enriched.push({ ...n, labels: next });
    }
    return enriched;
  },
};

export default adapter;
