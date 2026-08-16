import path from "node:path";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  type ReproducibilityMatrixCase,
} from "../lib/artifact-reproducibility-matrix";

export type ProtectedRustPatchCaseDefinition = {
  id: string;
  matrixCase: ReproducibilityMatrixCase;
  cargoRoot: string;
  cargoPackage: string;
  targetsFile: string;
  targetName: string;
};

export const PROTECTED_BEHAVIOR_BASELINE = "VIBEROOTS_PROTECTED_BEHAVIOR_42";
export const PROTECTED_BEHAVIOR_PATCHED = "VIBEROOTS_PROTECTED_BEHAVIOR_43";

export function protectedRustPatchCaseIds(system: string): string[] {
  return protectedRustPatchCaseDefinitions(system).map(({ id }) => id);
}

export function protectedRustPatchCaseDefinitions(
  system: string,
): ProtectedRustPatchCaseDefinition[] {
  return ARTIFACT_REPRODUCIBILITY_MATRIX.filter(
    (entry) => entry.artifactFamily === "rust" && entry.systems.includes(system),
  ).map((matrixCase) => ({
    id: matrixCase.id,
    matrixCase,
    ...casePaths(matrixCase),
  }));
}

function casePaths(
  matrixCase: ReproducibilityMatrixCase,
): Omit<ProtectedRustPatchCaseDefinition, "id" | "matrixCase"> {
  const destination = matrixCase.scaffoldRecipe.destination;
  if (matrixCase.id === "rust-cross-root-pr12") {
    const cargoRoot = path.join(destination, "libs", `${matrixCase.scaffoldRecipe.name}-core`);
    return {
      cargoRoot,
      cargoPackage: `${matrixCase.scaffoldRecipe.name}-core`,
      targetsFile: path.join(
        destination,
        "libs",
        `${matrixCase.scaffoldRecipe.name}-app`,
        "TARGETS",
      ),
      targetName: `${matrixCase.scaffoldRecipe.name}-app`,
    };
  }
  if (matrixCase.id === "rust-pyodide-extension-pr14") {
    return {
      cargoRoot: destination,
      cargoPackage: matrixCase.scaffoldRecipe.name,
      targetsFile: path.join(destination, "TARGETS"),
      targetName: `${matrixCase.scaffoldRecipe.name}-ext`,
    };
  }
  return {
    cargoRoot: destination,
    cargoPackage: matrixCase.scaffoldRecipe.name,
    targetsFile: path.join(destination, "TARGETS"),
    targetName: matrixCase.graphSelection.target.slice(
      matrixCase.graphSelection.target.lastIndexOf(":") + 1,
    ),
  };
}
