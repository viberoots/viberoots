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

/**
 * DRY validation for language classification across adapters.
 * Detects nodes whose sources "look like" the language but that are missing
 * both an appropriate rule_type prefix and the expected lang:<id> label.
 *
 * Returns zero or more human-readable findings; caller decides severity.
 */
export type LanguageClassificationOptions = {
  /**
   * Adapter/language identifier used in the finding prefix, e.g. "go", "cpp".
   */
  name: string;
  /**
   * Heuristic for whether the node appears to belong to this language
   * (e.g., has .go sources, or .cpp/.cc/.cxx sources).
   */
  looksLike(node: Node): boolean;
  /**
   * Whether the node's rule_type indicates this language (e.g., startsWith("go_")).
   */
  hasRuleType(node: Node): boolean;
  /**
   * Whether the node already carries the appropriate lang label (e.g., "lang:go").
   */
  hasLangLabel(node: Node): boolean;
  /**
   * Presentation hint used in the message for rule_type, e.g. "go_*" or "cxx_*".
   */
  ruleTypePrefix: string;
  /**
   * Back-compat alias for tests that expect this label field.
   */
  ruleTypePrefixLabel?: string;
  /**
   * Optional list of rule_type patterns used by registry parity tests.
   */
  ruleTypePatterns?: Array<string | RegExp>;
  /**
   * The exact language label expected, e.g., "lang:go".
   */
  langLabel: string;
  /**
   * Optional descriptive subject for sources in the message. Defaults to
   * "<name>-looking sources" when omitted (e.g., "go-looking sources").
   */
  subject?: string;
  /**
   * Optional guidance line appended to the message.
   */
  guidance?: string;
  /**
   * Limit of offenders listed verbatim in the message (default 10).
   */
  sampleLimit?: number;
};

export function validateLanguageClassification(
  nodes: Node[],
  opts: LanguageClassificationOptions,
): string[] {
  const {
    name,
    looksLike,
    hasRuleType,
    hasLangLabel,
    ruleTypePrefix,
    langLabel,
    subject,
    guidance,
    sampleLimit = 10,
  } = opts;

  const offenders: string[] = [];
  for (const n of nodes) {
    try {
      if (looksLike(n) && !hasRuleType(n) && !hasLangLabel(n)) {
        offenders.push(n.name);
      }
    } catch {
      // Best-effort; skip malformed nodes
    }
  }
  if (offenders.length === 0) return [];

  const shown = offenders.slice(0, sampleLimit).join("\n  - ");
  const more =
    offenders.length > sampleLimit ? `  ... and ${offenders.length - sampleLimit} more` : "";
  const subj = subject || `${name}-looking sources`;
  const lines = [
    `[exporter][${name}] targets include ${subj} but lack both ${ruleTypePrefix} rule_type and '${langLabel}' label:`,
    `  - ${shown}`,
    more,
    guidance || "",
  ].filter(Boolean);
  return [lines.join("\n")];
}
