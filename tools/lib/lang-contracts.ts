#!/usr/bin/env zx-wrapper

// Centralized language contracts used across provider sync, planner adapters, and scaffolding.

export type LangId = string;

export type PatchScope = "package-local" | "importer-local";

export type ProviderModel = "none" | "importer-scoped" | "curated";

export type PatchInvalidationStrategy = {
  patchScope: PatchScope;
  glueOnApplyRemove: boolean;
  providerModel: ProviderModel;
};

const PATCH_INVALIDATION_STRATEGY_BY_LANG: Record<string, PatchInvalidationStrategy> = {
  // Go and C++: package-local patch files are part of target inputs (srcs). No glue required.
  go: { patchScope: "package-local", glueOnApplyRemove: false, providerModel: "none" },
  cpp: { patchScope: "package-local", glueOnApplyRemove: false, providerModel: "curated" },

  // Node and Python: importer-local patch dirs, with importer-scoped providers and auto_map glue.
  node: { patchScope: "importer-local", glueOnApplyRemove: true, providerModel: "importer-scoped" },
  python: {
    patchScope: "importer-local",
    glueOnApplyRemove: true,
    providerModel: "importer-scoped",
  },
};

export function patchInvalidationStrategyForLang(id: LangId): PatchInvalidationStrategy | null {
  return PATCH_INVALIDATION_STRATEGY_BY_LANG[id] || null;
}

// Provider sync adapter contract (per-language)
export type LanguageProviderSync = {
  lang: LangId;
  sync: (opts?: { outFile?: string; patchDir?: string; strict?: boolean }) => Promise<void>;
};

// Planner-side language contract (for TS helpers or codegen callers). The actual
// planner is Nix; this shape is used by TS-side registries or generators.
export type PlannerLanguage = {
  id: LangId;
  // human-friendly checks used by TS pre-processing or docs tooling (optional)
  isTarget?: (node: { rule_type?: string; labels?: string[] }) => boolean;
  kindOf?: (node: { rule_type?: string; labels?: string[] }) => "bin" | "lib" | "test" | null;
};

// Scaffolding registry contract
export type ScaffoldingLanguage = {
  id: LangId;
  displayName: string;
  requiredPaths: string[];
  optionalPaths?: string[];
  kinds: string[];
  templatesDir: string;
};
