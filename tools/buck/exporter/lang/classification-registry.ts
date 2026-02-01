#!/usr/bin/env zx-wrapper
import type { Node } from "../types.ts";
import { hasLabel, isRuleType, type LanguageClassificationOptions } from "./helpers.ts";
import { importerScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";

export type LanguageClassificationKey = "go" | "cpp" | "node" | "python";

function srcsOf(node: Node): string[] {
  const srcs = (node as any).srcs;
  return Array.isArray(srcs) ? (srcs as string[]) : [];
}

const nodeImporterConfig = importerScopedAdapterRegistryEntry("node");

const LANGUAGE_CLASSIFICATION_REGISTRY = {
  go: {
    name: "go",
    looksLike(n: Node) {
      return srcsOf(n).some((s) => s.endsWith(".go"));
    },
    hasRuleType(n: Node) {
      return isRuleType(n, "go_");
    },
    ruleTypePatterns: ["go_"],
    hasLangLabel(n: Node) {
      return hasLabel(n, "lang:go");
    },
    ruleTypePrefix: "go_*",
    ruleTypePrefixLabel: "go_*",
    langLabel: "lang:go",
    subject: ".go sources",
    guidance: "Fix: ensure macros stamp 'lang:go' (and 'kind:bin') or use go_* rules.",
  },
  cpp: {
    name: "cpp",
    looksLike(n: Node) {
      return srcsOf(n).some((s) => /\.(cc|cpp|cxx)$/i.test(s));
    },
    hasRuleType(n: Node) {
      return isRuleType(n, "cxx_");
    },
    ruleTypePatterns: ["cxx_"],
    hasLangLabel(n: Node) {
      return hasLabel(n, "lang:cpp");
    },
    ruleTypePrefix: "cxx_*",
    ruleTypePrefixLabel: "cxx_*",
    langLabel: "lang:cpp",
    subject: "C++-looking sources",
    guidance: "Guidance: stamp 'lang:cpp' in macros or use cxx_* rules to classify C++ targets.",
  },
  node: {
    name: "node",
    looksLike(n: Node) {
      return nodeImporterConfig.hasLockfileLabelForThisEcosystem(n);
    },
    hasRuleType(n: Node) {
      return isRuleType(n, /^js_/) || isRuleType(n, /^node_/);
    },
    ruleTypePatterns: [/^js_/, /^node_/],
    hasLangLabel(n: Node) {
      return hasLabel(n, "lang:node");
    },
    ruleTypePrefix: "js_* or node_*",
    ruleTypePrefixLabel: "js_* or node_*",
    langLabel: "lang:node",
    subject: "macro-stamped Node targets",
    guidance: "Fix: ensure macros stamp 'lang:node' to classify Node targets consistently.",
  },
  python: {
    name: "python",
    looksLike(n: Node) {
      return srcsOf(n).some((s) => /\.py$/i.test(s));
    },
    hasRuleType(n: Node) {
      return isRuleType(n, "python_");
    },
    ruleTypePatterns: ["python_"],
    hasLangLabel(n: Node) {
      return hasLabel(n, "lang:python");
    },
    ruleTypePrefix: "python_*",
    ruleTypePrefixLabel: "python_*",
    langLabel: "lang:python",
    subject: "Python-looking sources",
    guidance:
      "Guidance: stamp 'lang:python' via macros or use python_* rules to classify Python targets.",
  },
} satisfies Record<LanguageClassificationKey, LanguageClassificationOptions>;

export function classificationRegistryEntry(
  lang: LanguageClassificationKey,
): LanguageClassificationOptions {
  return LANGUAGE_CLASSIFICATION_REGISTRY[lang];
}

export function languageClassificationEntry(
  lang: LanguageClassificationKey,
): LanguageClassificationOptions {
  return classificationRegistryEntry(lang);
}
