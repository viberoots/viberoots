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
  rust: { patchScope: "package-local", glueOnApplyRemove: false, providerModel: "none" },

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

export type ImporterPatchInclusionPolicy = "all" | "effective-set-only";

export type LockfileLabelAutoAttachRequirement = "requires-kind-stamp";

export type ImporterScopedProviderContract = {
  /**
   * Controls how importer-local patch files under `<importer>/patches/<lang>/*.patch` are included
   * in provider `patch_paths`.
   */
  importerPatchInclusionPolicy: ImporterPatchInclusionPolicy;
  /**
   * Optional global patch directory that is merged in only when patch keys match the importer
   * lockfile effective set (Node).
   */
  globalPatchDir?: {
    path: string;
    selection: "effective-set-only";
  };
  /**
   * Exporter auto-attach for importer-scoped lockfile labels is gated by kind stamping to avoid
   * inferring importer state for unlabeled helper targets.
   */
  lockfileLabelAutoAttachRequirement: LockfileLabelAutoAttachRequirement;
  /**
   * Provider sync parsing behavior. When strict is supported and enabled, parse failures are fatal;
   * otherwise the driver falls back to an empty effective set.
   */
  providerSyncParsing: { supportsStrict: boolean; defaultStrict: boolean };
};

const IMPORTER_SCOPED_PROVIDER_CONTRACT_BY_LANG: Record<string, ImporterScopedProviderContract> = {
  node: {
    importerPatchInclusionPolicy: "all",
    globalPatchDir: { path: "patches/node", selection: "effective-set-only" },
    lockfileLabelAutoAttachRequirement: "requires-kind-stamp",
    providerSyncParsing: { supportsStrict: false, defaultStrict: false },
  },
  python: {
    importerPatchInclusionPolicy: "effective-set-only",
    lockfileLabelAutoAttachRequirement: "requires-kind-stamp",
    providerSyncParsing: { supportsStrict: true, defaultStrict: false },
  },
};

export function importerScopedProviderContractForLang(
  id: LangId,
): ImporterScopedProviderContract | null {
  return IMPORTER_SCOPED_PROVIDER_CONTRACT_BY_LANG[id] || null;
}

export function patchPkgUsageNotes(): string[] {
  const node = importerScopedProviderContractForLang("node");
  const python = importerScopedProviderContractForLang("python");
  const nodeGlobal =
    node?.globalPatchDir?.path != null
      ? `Node also supports global patches under ${node.globalPatchDir.path} (effective-set matches only).`
      : null;
  const lines = [
    "- Go/C++ default to local mode: apply/remove write/read patches under <pkg>/patches/<lang>.",
    "  Removing a Go/C++ patch does not regenerate glue; Buck/Nix pick up the change via srcs.",
    "- Node and Python remain importer-scoped: apply/remove regenerates providers and auto_map (glue).",
  ];
  if (nodeGlobal) lines.push(`  ${nodeGlobal}`);
  if (node && python) {
    lines.push(
      `  Importer patch inclusion: node=${node.importerPatchInclusionPolicy}, python=${python.importerPatchInclusionPolicy}.`,
    );
  }
  return lines;
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
  hermetic: LanguageHermeticContract;
};

export type LanguageHermeticContract = {
  status: "scaffold" | "graduated";
  sourceRoles: boolean;
  dependencyReconciliation: boolean;
  immutableBundleInputs: boolean;
  storeQualifiedToolchain: boolean;
  selectorTransport: boolean;
  sandboxNetwork: boolean;
  remoteExecution: boolean;
  publicationAdmission: boolean;
  reproducibilityMatrixIds: string[];
};

const hermeticBooleanKeys = [
  "sourceRoles",
  "dependencyReconciliation",
  "immutableBundleInputs",
  "storeQualifiedToolchain",
  "selectorTransport",
  "sandboxNetwork",
  "remoteExecution",
  "publicationAdmission",
] as const;

export function languageGraduationGaps(contract?: LanguageHermeticContract): string[] {
  if (!contract) return ["hermetic contract is missing"];
  const gaps: string[] = hermeticBooleanKeys.filter((key) => contract[key] !== true);
  if (
    !Array.isArray(contract.reproducibilityMatrixIds) ||
    contract.reproducibilityMatrixIds.length === 0
  ) {
    gaps.push("reproducibilityMatrixIds");
  }
  return gaps;
}
