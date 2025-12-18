#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";
import { findNearestUvLockForPackage } from "../../../lib/importers.ts";
import {
  attachImporterLockfileLabelsIfMacroStamped,
  hasKindLabel,
  lockfileLabels,
  validateImporterLockfileLabels,
} from "./importer-lockfile-labels.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

function validateKindPresence(n: Node): string[] {
  if (!isPythonTarget(n)) return [];
  if (hasKindLabel(n)) return [];
  if (lockfileLabels(n).length === 0) return [];
  return [
    [
      `[exporter][python] missing kind:* label on ${n.name}.`,
      "Fix: use macros that stamp a kind label (e.g., 'kind:lib', 'kind:bin', 'kind:test').",
    ].join("\n"),
  ];
}

export const adapter: Adapter = {
  name: "python",
  isNode(n) {
    return isPythonTarget(n);
  },
  async validate(nodes: Node[]) {
    const out: string[] = [];
    const lockByPkg = new Map<string, Promise<string | null>>();
    const nearestLock = (pkgDir: string) => {
      const key = pkgDir || ".";
      const cur = lockByPkg.get(key);
      if (cur) return cur;
      const next = findNearestUvLockForPackage(key);
      lockByPkg.set(key, next);
      return next;
    };

    for (const n of nodes) {
      if (!isPythonTarget(n)) continue;
      out.push(...validateKindPresence(n));
      out.push(...validateImporterLockfileLabels({ adapterName: "python", node: n }));
      if (hasKindLabel(n) && lockfileLabels(n).length === 0) {
        const pkg = packageDirFromTargetName(n.name || "") || ".";
        const lockRel = await nearestLock(pkg);
        if (!lockRel) {
          out.push(
            [
              `[exporter][python] missing importer-scoped lockfile label on ${n.name}.`,
              `Fix: ensure a uv.lock exists in '${pkg}' (or an ancestor) so the exporter can attach lockfile:<path>#<importer>, or stamp the label explicitly via macros.`,
            ].join("\n"),
          );
        }
      }
    }

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
    return attachImporterLockfileLabelsIfMacroStamped({
      nodes,
      isTarget: isPythonTarget,
      findNearestLockfile: findNearestUvLockForPackage,
    });
  },
};

export default adapter;
