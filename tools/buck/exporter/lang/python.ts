#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";

function isPythonTarget(n: Node): boolean {
  return hasLabel(n, "lang:python") || isRuleType(n, "python_");
}

async function findNearestUvLock(startPkgDir: string): Promise<string | null> {
  // Walk up from the package directory to repo root looking for uv.lock
  // Return a repo-relative path when found.
  const repoRoot = process.cwd();
  let cur = path.resolve(repoRoot, startPkgDir || ".");
  // Guard: ensure cur is inside repoRoot
  const inside = (p: string) => p === repoRoot || p.startsWith(repoRoot + path.sep);
  while (inside(cur)) {
    const candidate = path.join(cur, "uv.lock");
    try {
      await fsp.access(candidate);
      // Produce a repo-relative path with forward slashes
      const rel = path.relative(repoRoot, candidate).replaceAll("\\", "/");
      return rel || "uv.lock";
    } catch {
      // Not found here; move up one directory
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return null;
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
    const repoRoot = process.cwd();
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
      const lockRel = await findNearestUvLock(pkg);
      if (!lockRel) {
        enriched.push(n);
        continue;
      }
      const importer =
        path.dirname(path.resolve(repoRoot, lockRel)) === repoRoot ? "." : path.dirname(lockRel);
      const label = `lockfile:${lockRel}#${importer}`;
      const next = Array.from(new Set([...(labs as string[]), label])).sort();
      enriched.push({ ...n, labels: next });
    }
    return enriched;
  },
};

export default adapter;
