import assert from "node:assert/strict";
import { test } from "node:test";
import { proveLanguageQualification } from "../../ci/artifact-reproducibility-language-qualification";
import { reproducibilityMatrixSystemPairs } from "../../lib/artifact-reproducibility-matrix";
import { graduatedLanguageManifestFixture } from "./artifact-reproducibility.fixture";

const successfulComparisons = reproducibilityMatrixSystemPairs().map(({ matrixId, system }) => ({
  subjectId: matrixId,
  system,
}));

test("protected aggregate rejects graduated language without successful required-route evidence", () => {
  const manifest = structuredClone(graduatedLanguageManifestFixture);
  const python = manifest.languages.find(({ id }) => id === "python")!;
  python.hermetic.reproducibilityMatrixIds = ["python-artifact"];
  assert.throws(
    () => proveLanguageQualification(manifest, successfulComparisons),
    /protected wasm route evidence/,
  );
});
