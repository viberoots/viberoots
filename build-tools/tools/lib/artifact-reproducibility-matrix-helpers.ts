import type { ReproducibilityNodeArtifact } from "./artifact-reproducibility-node-contract";

export type ReproducibilityMatrixCase = {
  id: string;
  artifactFamily: "go" | "node" | "python" | "cpp" | "rust" | "wasm" | "mixed";
  systems: readonly string[];
  systemEvidence?: {
    nativeExecution: readonly string[];
    failClosedUntilExternalEvidence: readonly string[];
  };
  scaffoldRecipe: {
    language: "go" | "ts" | "python" | "cpp" | "rust";
    template:
      | "lib"
      | "app"
      | "cli"
      | "wasm-lib"
      | "go-cpp-lib"
      | "proc-macro"
      | "python-extension"
      | "node-addon"
      | "cxx-bridge"
      | "cross-root"
      | "wasm"
      | "tauri-app";
    name: string;
    destination: string;
  };
  coverage: {
    routeCapabilities: readonly ("base" | "wasm" | "wasi" | "mixed" | "addon" | "desktop")[];
  };
  graphSelection: {
    attr: "graph-generator-selected";
    ruleTypes: readonly string[];
    requiredLabels: readonly string[];
    outputRole: string;
    target: string;
  };
  nodeArtifact?: ReproducibilityNodeArtifact;
  languageProofs: readonly {
    target: string;
    ruleTypes: readonly string[];
    requiredLabels: readonly string[];
  }[];
};

export function selection(
  ruleTypes: readonly string[],
  target: string,
  outputRole: string,
  requiredLabels: readonly string[],
) {
  return {
    attr: "graph-generator-selected" as const,
    ruleTypes,
    requiredLabels,
    outputRole,
    target,
  };
}

export function coverage(
  routeCapabilities: ReproducibilityMatrixCase["coverage"]["routeCapabilities"],
): ReproducibilityMatrixCase["coverage"] {
  return { routeCapabilities };
}

export function proof(
  ruleTypes: readonly string[],
  target: string,
  requiredLabels: readonly string[],
): ReproducibilityMatrixCase["languageProofs"][number] {
  return { requiredLabels, ruleTypes, target };
}

export function recipe(
  language: ReproducibilityMatrixCase["scaffoldRecipe"]["language"],
  template: ReproducibilityMatrixCase["scaffoldRecipe"]["template"],
  name: string,
  destination: string,
): ReproducibilityMatrixCase["scaffoldRecipe"] {
  return { destination, language, name, template };
}
