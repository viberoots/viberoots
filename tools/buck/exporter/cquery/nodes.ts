#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../../../lib/labels.ts";
import type { Node } from "../types.ts";

function uniqSorted(xs: string[]): string[] {
  return Array.from(new Set((xs || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function isTmpTarget(label: string): boolean {
  // Match // .tmp / paths across cells (e.g., root//.tmp/foo:bar or //.tmp/foo:bar)
  return /\/\/\.tmp\//.test(String(label || ""));
}

function coerceStringArray(v: any): string[] | undefined {
  return Array.isArray(v) ? (v as any[]).filter((x) => typeof x === "string") : undefined;
}

export function nodesFromCqueryJson(merged: Record<string, any>): Node[] {
  const nodes: Node[] = [];
  for (const [label, raw] of Object.entries(merged || {})) {
    const a = (raw || {}) as Record<string, any>;
    const ruleType: string | undefined =
      typeof a["rule_type"] === "string"
        ? (a["rule_type"] as string)
        : (a["buck.type"] as string | undefined);
    const deps =
      coerceStringArray(a["deps"]) ??
      coerceStringArray(a["buck.deps"]) ??
      coerceStringArray(a["deps"]);
    const labelsArr =
      coerceStringArray(a["labels"]) ??
      coerceStringArray(a["buck.labels"]) ??
      coerceStringArray(a["labels"]);
    const srcsArr =
      coerceStringArray(a["srcs"]) ??
      coerceStringArray(a["buck.srcs"]) ??
      coerceStringArray(a["srcs"]);

    const clean = normalizeTargetLabel(label);
    if (!clean || isTmpTarget(clean)) continue;
    const cleanDeps = deps ? deps.map((d) => normalizeTargetLabel(d)) : undefined;

    nodes.push({
      ...(a as any),
      name: clean,
      rule_type: ruleType || a["rule_type"] || "",
      deps: cleanDeps || deps || a["deps"],
      labels: uniqSorted(labelsArr || []),
      srcs: srcsArr || a["srcs"],
    } as Node);
  }

  // De-duplicate by normalized target label (node.name), preferring richer nodes.
  const mergedByName = new Map<string, Node>();
  for (const n of nodes) {
    const key = String((n as any)?.name || "");
    if (!key) continue;
    const cur = mergedByName.get(key);
    if (!cur) {
      mergedByName.set(key, n);
      continue;
    }
    const curRule = String((cur as any).rule_type || "");
    const nextRule = String((n as any).rule_type || "");
    const preferNextRule =
      (curRule === "" || curRule === "forward") && nextRule !== "" && nextRule !== "forward";
    mergedByName.set(key, {
      ...(cur as any),
      ...(n as any),
      rule_type: preferNextRule ? nextRule : curRule,
      labels: uniqSorted([...(cur.labels || []), ...((n.labels as any) || [])]),
      deps: uniqSorted([...(cur.deps || []), ...((n.deps as any) || [])]),
      srcs: uniqSorted([...(cur.srcs || []), ...((n.srcs as any) || [])]),
    });
  }

  return Array.from(mergedByName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
