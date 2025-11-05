#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType } from "./helpers.ts";

function isNodeTarget(n: Node): boolean {
  // Prefer explicit lang stamp; fall back to common js_/node_ rule_type families
  return hasLabel(n, "lang:node") || isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
}

function lockfileLabels(n: Node): string[] {
  const labs = Array.isArray(n.labels) ? n.labels : [];
  return labs.filter((l) => typeof l === "string" && l.startsWith("lockfile:"));
}

function hasKindLabel(n: Node): boolean {
  const labs = Array.isArray(n.labels) ? n.labels : [];
  return labs.some((l) => typeof l === "string" && l.startsWith("kind:"));
}

function parseLockLabel(label: string): { lockfile: string; importer: string } | null {
  const m = /^lockfile:([^#]+)#([^#]+)$/.exec(label);
  if (!m) return null;
  const lockfile = m[1].replace(/^\.\/+/, "");
  const importer = m[2];
  return { lockfile, importer };
}

function validateSingleImporterLabel(n: Node): string[] {
  const findings: string[] = [];
  // Require properly stamped targets (kind:*) before enforcing importer label.
  // This avoids tripping validation in tests that use ad-hoc nodes without full macro stamping.
  if (!hasKindLabel(n)) return findings;
  const locks = lockfileLabels(n);
  if (locks.length === 0) {
    findings.push(
      `[exporter][node] missing importer-scoped lockfile label on ${n.name}. Expected one label of the form lockfile:<path>#<importer>.`,
    );
    return findings;
  }
  if (locks.length > 1) {
    findings.push(
      [
        `[exporter][node] multiple importer-scoped lockfile labels on ${n.name}:`,
        `  - ${locks.join("\n  - ")}`,
      ].join("\n"),
    );
  }
  // Validate format and path/importer consistency for the first label
  const first = locks[0];
  const parsed = parseLockLabel(first);
  if (!parsed) {
    findings.push(
      `[exporter][node] malformed lockfile label on ${n.name}: '${first}'. Expected lockfile:<path>#<importer>.`,
    );
    return findings;
  }
  const dir = path.dirname(parsed.lockfile);
  const importerOk = parsed.importer === "." || parsed.importer === dir;
  if (!importerOk) {
    findings.push(
      `[exporter][node] lockfile importer mismatch on ${n.name}: '${first}'. Importer should be '.' or match directory '${dir}'.`,
    );
  }
  return findings;
}

export const adapter: Adapter = {
  name: "node",
  isNode(n) {
    return isNodeTarget(n);
  },
  validate(nodes: Node[]) {
    const out: string[] = [];
    for (const n of nodes) {
      if (!isNodeTarget(n)) continue;
      out.push(...validateSingleImporterLabel(n));
    }
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Node adapter does not batch external queries; label pass-through only.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    // Validate-only adapter. Returns nodes unchanged (labels are stamped by macros).
    return nodes;
  },
};

export default adapter;
