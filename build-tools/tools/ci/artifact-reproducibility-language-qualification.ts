import {
  hasReproducibilityMatrixId,
  reproducibilityMatrixCase,
  reproducibilityMatrixCaseCoversLanguage,
  reproducibilityMatrixCoverage,
} from "../lib/artifact-reproducibility-matrix";

export type LanguageQualificationProof = {
  languageId: string;
  matrixIds: string[];
  requiredRoutes: string[];
  status: "candidate" | "graduated";
  publicationAdmitted: boolean;
};

export function proveLanguageQualification(
  manifest: unknown,
  matrixComparisons: readonly { subjectId: string; system: string }[],
): LanguageQualificationProof[] {
  const doc = manifest as { enabled?: unknown; languages?: unknown };
  if (!Array.isArray(doc.enabled) || !Array.isArray(doc.languages)) {
    throw new Error("protected aggregate requires the immutable language manifest");
  }
  const enabled = [...new Set(doc.enabled.map(String))].sort();
  const languages = new Map(
    doc.languages.map((entry) => [String((entry as { id?: unknown }).id || ""), entry]),
  );
  const successful = new Set<string>();
  for (const id of new Set(matrixComparisons.map(({ subjectId }) => subjectId))) {
    if (
      reproducibilityMatrixCase(id).systems.every((system) =>
        matrixComparisons.some(
          (comparison) => comparison.subjectId === id && comparison.system === system,
        ),
      )
    ) {
      successful.add(id);
    }
  }
  return enabled.map((languageId) => {
    const language = languages.get(languageId) as
      | {
          kinds?: unknown;
          hermetic?: {
            status?: unknown;
            publicationAdmission?: unknown;
            reproducibilityMatrixIds?: unknown;
          };
        }
      | undefined;
    const matrixIds = Array.isArray(language?.hermetic?.reproducibilityMatrixIds)
      ? language.hermetic.reproducibilityMatrixIds.map(String).sort()
      : [];
    const hermeticStatus = language?.hermetic?.status;
    if (
      (hermeticStatus !== "experimental" && hermeticStatus !== "graduated") ||
      !matrixIds.length
    ) {
      throw new Error(
        `enabled language is not eligible for protected qualification: ${languageId}`,
      );
    }
    for (const matrixId of matrixIds) {
      if (
        !hasReproducibilityMatrixId(matrixId) ||
        !reproducibilityMatrixCaseCoversLanguage(matrixId, languageId) ||
        !successful.has(matrixId)
      ) {
        throw new Error(`language lacks a successful matrix comparison: ${languageId}`);
      }
    }
    const requiredRoutes = new Set<string>(["base"]);
    for (const kind of Array.isArray(language.kinds) ? language.kinds.map(String) : []) {
      if (["wasm", "wasi", "mixed", "addon"].includes(kind)) requiredRoutes.add(kind);
    }
    const covered = reproducibilityMatrixCoverage(matrixIds, languageId);
    for (const route of requiredRoutes) {
      if (!covered.has(route as "base")) {
        throw new Error(`language lacks protected ${route} route evidence: ${languageId}`);
      }
    }
    const status = hermeticStatus === "graduated" ? "graduated" : "candidate";
    return {
      languageId,
      matrixIds,
      requiredRoutes: [...requiredRoutes].sort(),
      status,
      publicationAdmitted:
        status === "graduated" && language.hermetic?.publicationAdmission === true,
    };
  });
}

export function assertLanguageQualificationProofs(
  proofs: readonly LanguageQualificationProof[],
  comparisons: readonly { subjectId: string; system: string }[],
): void {
  if (!proofs.length) {
    throw new Error("protected aggregate lacks language qualification evidence");
  }
  const ids = proofs.map(({ languageId }) => languageId);
  if (ids.join("\0") !== [...new Set(ids)].sort().join("\0")) {
    throw new Error("language qualification evidence is not canonical");
  }
  for (const proof of proofs) {
    if (
      Object.keys(proof).sort().join("\0") !==
        ["languageId", "matrixIds", "publicationAdmitted", "requiredRoutes", "status"]
          .sort()
          .join("\0") ||
      (proof.status !== "candidate" && proof.status !== "graduated") ||
      proof.publicationAdmitted !== (proof.status === "graduated")
    ) {
      throw new Error(`language qualification state is invalid: ${proof.languageId}`);
    }
    if (!proof.matrixIds.length || !proof.requiredRoutes.includes("base")) {
      throw new Error(`language qualification evidence is incomplete: ${proof.languageId}`);
    }
    const coverage = reproducibilityMatrixCoverage(proof.matrixIds, proof.languageId);
    for (const matrixId of proof.matrixIds) {
      if (
        !reproducibilityMatrixCaseCoversLanguage(matrixId, proof.languageId) ||
        !reproducibilityMatrixCase(matrixId).systems.every((system) =>
          comparisons.some(
            (comparison) => comparison.subjectId === matrixId && comparison.system === system,
          ),
        )
      ) {
        throw new Error(
          `language qualification proof lacks successful comparisons: ${proof.languageId}`,
        );
      }
    }
    if (proof.requiredRoutes.some((route) => !coverage.has(route as "base"))) {
      throw new Error(`language qualification proof lacks required routes: ${proof.languageId}`);
    }
  }
}
