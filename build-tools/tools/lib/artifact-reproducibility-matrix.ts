import crypto from "node:crypto";
import {
  reproducibilityNodeArtifact,
  type ReproducibilityNodeArtifact,
} from "./artifact-reproducibility-node-contract";

export const RELEASE_BUILDER_SYSTEMS = ["aarch64-darwin", "aarch64-linux", "x86_64-linux"] as const;

export type ReproducibilityMatrixCase = {
  id: string;
  artifactFamily: "go" | "node" | "python" | "cpp" | "wasm" | "mixed";
  systems: readonly string[];
  scaffoldRecipe: {
    language: "go" | "ts" | "python" | "cpp";
    template: "lib" | "app" | "wasm-lib" | "go-cpp-lib";
    name: string;
    destination: string;
  };
  coverage: {
    routeCapabilities: readonly ("base" | "wasm" | "mixed" | "addon")[];
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

const matrix = [
  {
    id: "go-lib",
    artifactFamily: "go",
    scaffoldRecipe: recipe("go", "lib", "repro-go", "projects/libs/repro-go"),
    coverage: coverage(["base"]),
    graphSelection: selection(["go_nix_build"], "//projects/libs/repro-go:repro-go", "library", [
      "lang:go",
    ]),
    languageProofs: [],
  },
  {
    id: "node-artifact",
    artifactFamily: "node",
    scaffoldRecipe: recipe("ts", "lib", "repro-node", "projects/libs/repro-node"),
    coverage: coverage(["base"]),
    graphSelection: selection(["genrule"], "//projects/libs/repro-node:repro-node", "library", [
      "lang:node",
    ]),
    nodeArtifact: reproducibilityNodeArtifact("esm", "projects/libs/repro-node/src/index.ts", [
      "dist/index.mjs",
    ]),
    languageProofs: [],
  },
  {
    id: "python-artifact",
    artifactFamily: "python",
    scaffoldRecipe: recipe("python", "app", "repro-python", "projects/apps/repro-python"),
    coverage: coverage(["base"]),
    graphSelection: selection(
      ["python_nix_build"],
      "//projects/apps/repro-python:repro-python",
      "executable",
      ["lang:python"],
    ),
    languageProofs: [],
  },
  {
    id: "cpp-lib",
    artifactFamily: "cpp",
    scaffoldRecipe: recipe("cpp", "lib", "repro-cpp", "projects/libs/repro-cpp"),
    coverage: coverage(["base"]),
    graphSelection: selection(["cpp_nix_build"], "//projects/libs/repro-cpp:repro-cpp", "library", [
      "lang:cpp",
    ]),
    languageProofs: [],
  },
  {
    id: "wasm-artifact",
    artifactFamily: "wasm",
    scaffoldRecipe: recipe("python", "wasm-lib", "repro-wasm", "projects/libs/repro-wasm"),
    coverage: coverage(["wasm"]),
    graphSelection: selection(
      ["python_nix_wasm_build"],
      "//projects/libs/repro-wasm:repro-wasm",
      "wasm-module",
      ["lang:python", "kind:wasm"],
    ),
    languageProofs: [],
  },
  {
    id: "mixed-artifact",
    artifactFamily: "mixed",
    scaffoldRecipe: recipe("ts", "go-cpp-lib", "repro-mixed", "projects"),
    coverage: coverage(["addon", "mixed"]),
    graphSelection: selection(
      ["genrule"],
      "//projects/libs/repro-mixed-ts:repro-mixed_ts_pkg",
      "node-package",
      ["lang:node"],
    ),
    nodeArtifact: reproducibilityNodeArtifact(
      "esm-with-native-addon",
      "projects/libs/repro-mixed-ts/src/node/index.ts",
      ["dist/node/index.mjs", "dist/native/napi_addon.node"],
      "//projects/libs/repro-mixed-native:napi_addon",
    ),
    languageProofs: [
      proof(["cpp_nix_build"], "//projects/libs/repro-mixed-native:napi_addon", [
        "lang:cpp",
        "kind:addon",
      ]),
      proof(["go_nix_build"], "//projects/libs/repro-mixed-go:carchive", [
        "lang:go",
        "kind:carchive",
      ]),
    ],
  },
] as const;

export const ARTIFACT_REPRODUCIBILITY_MATRIX: readonly ReproducibilityMatrixCase[] = matrix.map(
  (entry) => ({ ...entry, systems: RELEASE_BUILDER_SYSTEMS }),
);

export const ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST = `sha256:${crypto
  .createHash("sha256")
  .update(canonicalJson(ARTIFACT_REPRODUCIBILITY_MATRIX))
  .digest("hex")}`;

export function reproducibilityMatrixCase(id: string): ReproducibilityMatrixCase {
  const entry = ARTIFACT_REPRODUCIBILITY_MATRIX.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown artifact reproducibility matrix ID: ${id}`);
  return entry;
}

export function reproducibilityRecipeDigest(id: string): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalJson(reproducibilityMatrixCase(id).scaffoldRecipe))
    .digest("hex")}`;
}

function selection(
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

function coverage(
  routeCapabilities: ReproducibilityMatrixCase["coverage"]["routeCapabilities"],
): ReproducibilityMatrixCase["coverage"] {
  return { routeCapabilities };
}

function proof(
  ruleTypes: readonly string[],
  target: string,
  requiredLabels: readonly string[],
): ReproducibilityMatrixCase["languageProofs"][number] {
  return { requiredLabels, ruleTypes, target };
}

function recipe(
  language: ReproducibilityMatrixCase["scaffoldRecipe"]["language"],
  template: ReproducibilityMatrixCase["scaffoldRecipe"]["template"],
  name: string,
  destination: string,
): ReproducibilityMatrixCase["scaffoldRecipe"] {
  return { destination, language, name, template };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hasReproducibilityMatrixId(id: string): boolean {
  return ARTIFACT_REPRODUCIBILITY_MATRIX.some((entry) => entry.id === id);
}

export function reproducibilityMatrixCaseCoversLanguage(id: string, languageId: string): boolean {
  return graphProvenLanguageIds(reproducibilityMatrixCase(id)).has(languageId);
}

export function reproducibilityMatrixCoverage(
  ids: readonly string[],
  languageId: string,
): Set<"base" | "wasm" | "mixed" | "addon"> {
  return new Set(
    ids.flatMap((id) => {
      const entry = reproducibilityMatrixCase(id);
      return graphProvenLanguageIds(entry).has(languageId) ? entry.coverage.routeCapabilities : [];
    }),
  );
}

function graphProvenLanguageIds(entry: ReproducibilityMatrixCase): Set<string> {
  return new Set(
    [entry.graphSelection, ...entry.languageProofs].flatMap(({ requiredLabels }) =>
      requiredLabels
        .filter((label) => label.startsWith("lang:"))
        .map((label) => label.slice("lang:".length)),
    ),
  );
}

export function assertReproducibilityMatrixBinding(opts: {
  matrixId: string;
  artifactFamily: string;
  system: string;
}): void {
  const entry = reproducibilityMatrixCase(opts.matrixId);
  if (entry.artifactFamily !== opts.artifactFamily) {
    throw new Error(
      `reproducibility matrix ${entry.id} requires ${entry.artifactFamily} artifacts`,
    );
  }
  if (!entry.systems.includes(opts.system)) {
    throw new Error(`reproducibility matrix ${entry.id} does not cover Nix system ${opts.system}`);
  }
}
