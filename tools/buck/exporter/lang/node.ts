#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { findNearestPnpmLockForPackage } from "../../../lib/importers.ts";
import { parseLockfileLabel } from "../../../lib/labels.ts";
import { lockfileLabels } from "./importer-lockfile-labels.ts";
import {
  attachImporterScopedLockfileLabels,
  validateImporterScopedAdapter,
} from "./importer-scoped-adapter.ts";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

function hasPnpmLockfileLabel(n: Node): boolean {
  const locks = lockfileLabels(n);
  return locks.some((l) => {
    const parsed = parseLockfileLabel(l);
    if (!parsed) return false;
    return parsed.lockfile === "pnpm-lock.yaml" || parsed.lockfile.endsWith("/pnpm-lock.yaml");
  });
}

export const adapter: Adapter = {
  name: "node",
  isNode(n) {
    return isNodeTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    out.push(
      ...(await validateImporterScopedAdapter(nodes, {
        adapterName: "node",
        lockfileBasename: "pnpm-lock.yaml",
        isTarget: isNodeTarget,
        findNearestLockfile: findNearestPnpmLockForPackage,
        shouldWarnMissingKindLabel(n) {
          // Only enforce kind:* for Node targets that appear to be stamped by our macros
          // (i.e., carry an importer-scoped lockfile label). This avoids flagging ad-hoc
          // nodes created in tests or external rules that are not using our macros.
          return lockfileLabels(n).length > 0;
        },
      })),
    );

    // PR-5: advisory for missing lang:node using shared classification helper.
    // Narrow scope: only consider nodes that appear macro-stamped (have importer-scoped lockfile label).
    out.push(
      ...validateLanguageClassification(nodes, {
        name: "node",
        looksLike(n: Node) {
          // Only treat nodes with PNPM importer-scoped lockfile labels as Node-like
          return hasPnpmLockfileLabel(n);
        },
        hasRuleType(n: Node) {
          return isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
        },
        hasLangLabel(n: Node) {
          return hasLabel(n, "lang:node");
        },
        ruleTypePrefix: "js_* or node_*",
        langLabel: "lang:node",
        subject: "macro-stamped Node targets",
        guidance: "Fix: ensure macros stamp 'lang:node' to classify Node targets consistently.",
      }),
    );
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Node adapter does not batch external queries; label pass-through only.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    return attachImporterScopedLockfileLabels({
      nodes,
      adapterName: "node",
      lockfileBasename: "pnpm-lock.yaml",
      isTarget: isNodeTarget,
      findNearestLockfile: findNearestPnpmLockForPackage,
    });
  },
};

export default adapter;
