#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType, validateLanguageClassification } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";
import { parseLockfileLabelParts } from "../../../lib/labels.ts";
import { computeImporterLabel, findNearestPnpmLockForPackage } from "../../../lib/importers.ts";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

function lockfileLabels(n: Node): string[] {
  const labs = Array.isArray(n.labels) ? n.labels : [];
  return labs.filter((l) => typeof l === "string" && l.startsWith("lockfile:"));
}

function hasPnpmLockfileLabel(n: Node): boolean {
  const locks = lockfileLabels(n);
  return locks.some((l) => /lockfile:.*\/?pnpm-lock\.yaml#/.test(l));
}

function hasKindLabel(n: Node): boolean {
  const labs = Array.isArray(n.labels) ? n.labels : [];
  return labs.some((l) => typeof l === "string" && l.startsWith("kind:"));
}

function validateSingleImporterLabel(n: Node): string[] {
  const findings: string[] = [];
  // Require properly stamped targets (kind:*) before enforcing importer label.
  // This avoids tripping validation in tests that use ad-hoc nodes without full macro stamping.
  if (!hasKindLabel(n)) return findings;
  const locks = lockfileLabels(n);
  if (locks.length === 0) return findings;
  if (locks.length > 1) {
    findings.push(
      [
        `[exporter][node] multiple importer-scoped lockfile labels on ${n.name}:`,
        `  - ${locks.join("\n  - ")}`,
        `Fix: keep exactly one importer label of the form lockfile:<path>#<importer>.`,
      ].join("\n"),
    );
  }
  // Validate format and path/importer consistency for the first label
  const first = locks[0];
  const parsed = parseLockfileLabelParts(first);
  if (!parsed) {
    findings.push(
      [
        `[exporter][node] malformed lockfile label on ${n.name}: '${first}'.`,
        `Expected: lockfile:<path>#<importer> (example: lockfile:apps/web/pnpm-lock.yaml#apps/web).`,
      ].join("\n"),
    );
    return findings;
  }
  const dir = path.posix.dirname(parsed.lockfile);
  const importerOk = parsed.importer === "." || parsed.importer === dir;
  if (!importerOk) {
    findings.push(
      [
        `[exporter][node] lockfile importer mismatch on ${n.name}: '${first}'.`,
        `Fix: set importer to '.' (lockfile at repo root) or to '${dir}' to match the lockfile directory.`,
      ].join("\n"),
    );
  }
  return findings;
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
    const enriched: Node[] = [];
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
      if (!isNodeTarget(n)) {
        enriched.push(n);
        continue;
      }
      const labs = Array.isArray(n.labels) ? [...n.labels] : [];
      const hasLock = labs.some((l) => typeof l === "string" && l.startsWith("lockfile:"));
      // Only attach when a kind:* label is present (macro-like nodes) and no lockfile label exists.
      const haveKind = hasKindLabel(n);
      if (hasLock || !haveKind) {
        enriched.push(n);
        continue;
      }
      const pkg = packageDirFromTargetName(n.name || "") || ".";
      const lockRel = await nearestLock(pkg);
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
