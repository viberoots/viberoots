#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";
import { findNearestPnpmLockForPackage } from "../../../lib/importers.ts";
import {
  attachImporterLockfileLabelsIfMacroStamped,
  hasKindLabel,
  lockfileLabels,
  validateImporterLockfileLabels,
} from "./importer-lockfile-labels.ts";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

function hasPnpmLockfileLabel(n: Node): boolean {
  const locks = lockfileLabels(n);
  return locks.some((l) => /lockfile:.*\/?pnpm-lock\.yaml#/.test(l));
}

function validateSingleImporterLabel(n: Node): string[] {
  return validateImporterLockfileLabels({ adapterName: "node", node: n });
}

function validateKindPresence(n: Node): string[] {
  if (!isNodeTarget(n)) return [];
  if (hasKindLabel(n)) return [];
  // Only enforce kind:* for Node targets that appear to be stamped by our macros
  // (i.e., carry an importer-scoped lockfile label). This avoids flagging ad-hoc
  // nodes created in tests or external rules that are not using our macros.
  if (lockfileLabels(n).length === 0) return [];
  return [
    [
      `[exporter][node] missing kind:* label on ${n.name}.`,
      "Fix: use macros that stamp a kind label (e.g., 'kind:lib', 'kind:bin', 'kind:test', 'kind:bundle').",
    ].join("\n"),
  ];
}

export const adapter: Adapter = {
  name: "node",
  isNode(n) {
    return isNodeTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    const lockByPkg = new Map<string, Promise<string | null>>();
    const nearestLock = (pkgDir: string) => {
      const key = pkgDir || ".";
      const cur = lockByPkg.get(key);
      if (cur) return cur;
      const next = findNearestPnpmLockForPackage(key);
      lockByPkg.set(key, next);
      return next;
    };
    for (const n of nodes) {
      if (!isNodeTarget(n)) continue;
      // First, ensure macro-stamped kind label is present for Node targets.
      out.push(...validateKindPresence(n));
      out.push(...validateSingleImporterLabel(n));
      if (hasKindLabel(n) && lockfileLabels(n).length === 0) {
        const pkg = packageDirFromTargetName(n.name || "") || ".";
        const lockRel = await nearestLock(pkg);
        if (!lockRel) {
          out.push(
            [
              `[exporter][node] missing importer-scoped lockfile label on ${n.name}.`,
              `Fix: ensure a pnpm-lock.yaml exists in '${pkg}' (or an ancestor) so the exporter can attach lockfile:<path>#<importer>, or stamp the label explicitly via macros.`,
            ].join("\n"),
          );
        }
      }
    }
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
    return attachImporterLockfileLabelsIfMacroStamped({
      nodes,
      isTarget: isNodeTarget,
      findNearestLockfile: findNearestPnpmLockForPackage,
    });
  },
};

export default adapter;
