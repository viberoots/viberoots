import {
  coverage,
  recipe,
  selection,
  type ReproducibilityMatrixCase,
} from "./artifact-reproducibility-matrix-helpers";

export function rustCliCase(
  systems: readonly string[],
  id: string,
  name: string,
  suffix: "test",
  kindLabel: string,
): ReproducibilityMatrixCase {
  const destination = `projects/apps/${name}`;
  return {
    id,
    artifactFamily: "rust",
    systems,
    systemEvidence: configuredRustSystemEvidence(),
    scaffoldRecipe: recipe("rust", "cli", name, destination),
    coverage: coverage(["base"]),
    graphSelection: selection(["rust_nix_test"], `//${destination}:${name}-${suffix}`, suffix, [
      "lang:rust",
      kindLabel,
    ]),
    languageProofs: [],
  };
}

export function rustWasmCase(
  systems: readonly string[],
  id: string,
  name: string,
  suffix: string,
  outputRole: string,
  variantLabels: string[],
  route: "wasm" | "wasi" = "wasm",
): ReproducibilityMatrixCase {
  const destination = `projects/libs/${name}`;
  return {
    id,
    artifactFamily: "rust",
    systems,
    systemEvidence: configuredRustSystemEvidence(),
    scaffoldRecipe: recipe("rust", "wasm", name, destination),
    coverage: coverage([route]),
    graphSelection: selection(["rust_nix_build"], `//${destination}:${name}${suffix}`, outputRole, [
      "lang:rust",
      ...variantLabels,
    ]),
    languageProofs: [],
  };
}

export function rustCase(
  systems: readonly string[],
  id: string,
  template: "lib" | "proc-macro" | "python-extension" | "node-addon" | "cxx-bridge",
  name: string,
  outputRole: string,
  kindLabel: string,
  routeCapabilities: ReproducibilityMatrixCase["coverage"]["routeCapabilities"] = ["base"],
  targetSuffix = "",
): ReproducibilityMatrixCase {
  const destination = `projects/libs/${name}`;
  return {
    id,
    artifactFamily: "rust",
    systems,
    systemEvidence: configuredRustSystemEvidence(),
    scaffoldRecipe: recipe("rust", template, name, destination),
    coverage: coverage(routeCapabilities),
    graphSelection: selection(
      ["rust_nix_build"],
      `//${destination}:${name}${targetSuffix}`,
      outputRole,
      ["lang:rust", kindLabel],
    ),
    languageProofs: [],
  };
}

export function configuredRustSystemEvidence() {
  return {
    nativeExecution: ["aarch64-darwin"],
    failClosedUntilExternalEvidence: ["aarch64-linux", "x86_64-linux"],
  };
}
