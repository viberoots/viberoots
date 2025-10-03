#!/usr/bin/env zx-wrapper

// Centralized language contracts used across provider sync, planner adapters, and scaffolding.

export type LangId = string;

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
