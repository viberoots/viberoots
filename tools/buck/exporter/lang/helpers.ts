#!/usr/bin/env zx-wrapper
import type { Node } from "../types.ts";

/**
 * Return true when the node's labels contain the provided label.
 */
export function hasLabel(node: Node, label: string): boolean {
  const labs = Array.isArray(node.labels) ? node.labels : [];
  return labs.includes(label);
}

/**
 * Return true when the node's rule_type matches the provided pattern.
 * A string argument is treated as a required prefix; a RegExp tests directly.
 */
export function isRuleType(node: Node, pattern: string | RegExp): boolean {
  const rt = String(node.rule_type || "");
  if (typeof pattern === "string") return rt.startsWith(pattern);
  return pattern.test(rt);
}

/**
 * Produce a shallow copy of nodes with labels deduped and sorted, and nodes
 * sorted stably by name. Useful before emitting final JSON to provide
 * deterministic ordering.
 */
export function sortedUniqueLabels(nodes: Node[]): Node[] {
  return nodes
    .map((n) => ({ ...n, labels: Array.from(new Set(n.labels || [])).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
