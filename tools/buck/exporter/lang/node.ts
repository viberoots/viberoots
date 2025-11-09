#!/usr/bin/env zx-wrapper
import path from "node:path";
import * as fsp from "node:fs/promises";
import type { Adapter, Batch, Node } from "../types.ts";
import { hasLabel, isRuleType } from "./helpers.ts";
import { packageDirFromTargetName } from "../batch.ts";

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
      [
        `[exporter][node] missing importer-scoped lockfile label on ${n.name}.`,
        `Fix: stamp exactly one label via macros: lockfile:<path>#<importer> (e.g., lockfile:apps/web/pnpm-lock.yaml#apps/web).`,
      ].join("\n"),
    );
    return findings;
  }
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
  const parsed = parseLockLabel(first);
  if (!parsed) {
    findings.push(
      [
        `[exporter][node] malformed lockfile label on ${n.name}: '${first}'.`,
        `Expected: lockfile:<path>#<importer> (example: lockfile:apps/web/pnpm-lock.yaml#apps/web).`,
      ].join("\n"),
    );
    return findings;
  }
  const dir = path.dirname(parsed.lockfile);
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
  validate(nodes: Node[]) {
    const out: string[] = [];
    for (const n of nodes) {
      if (!isNodeTarget(n)) continue;
      // First, ensure macro-stamped kind label is present for Node targets.
      out.push(...validateKindPresence(n));
      out.push(...validateSingleImporterLabel(n));
    }
    return out;
  },
  async buildBatches(_nodes: Node[]): Promise<Batch[]> {
    // Node adapter does not batch external queries; label pass-through only.
    return [];
  },
  async attachLabels(nodes: Node[]): Promise<Node[]> {
    // Env-gated authoritative attach (symmetry-only enhancement). Default off.
    // Set EXPORTER_NODE_ATTACH=1 to enable stamping missing lockfile labels.
    const attach = (() => {
      const v = String(process.env.EXPORTER_NODE_ATTACH || "")
        .trim()
        .toLowerCase();
      return v === "1" || v === "true";
    })();
    if (!attach) return nodes;

    const enriched: Node[] = [];
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
      // Derive importer candidate from the Buck target name: //pkg:rule → pkg
      const pkg = packageDirFromTargetName(n.name || "") || ".";
      const lockRel = pkg === "." ? "pnpm-lock.yaml" : `${pkg}/pnpm-lock.yaml`;
      try {
        // If a lockfile exists at the derived path, stamp an importer-scoped label.
        await fsp.access(path.resolve(process.cwd(), lockRel));
        const importer = pkg === "." ? "." : pkg;
        const label = `lockfile:${lockRel}#${importer}`;
        const next = Array.from(new Set([...(labs as string[]), label])).sort();
        enriched.push({ ...n, labels: next });
      } catch {
        // No lockfile at the derived location; leave node unchanged.
        enriched.push(n);
      }
    }
    return enriched;
  },
};

export default adapter;
