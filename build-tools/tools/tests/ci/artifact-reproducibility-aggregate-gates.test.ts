import assert from "node:assert/strict";
import { test } from "node:test";
import { proveGraduatedLanguageCoverage } from "../../ci/artifact-reproducibility-aggregate-gates";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  RELEASE_BUILDER_SYSTEMS,
} from "../../lib/artifact-reproducibility-matrix";
import { graduatedLanguageManifestFixture } from "./artifact-reproducibility.fixture";

const successfulComparisons = ARTIFACT_REPRODUCIBILITY_MATRIX.flatMap(({ id }) =>
  RELEASE_BUILDER_SYSTEMS.map((system) => ({ subjectId: id, system })),
);

test("protected aggregate rejects graduated language without successful required-route evidence", () => {
  const manifest = structuredClone(graduatedLanguageManifestFixture);
  const python = manifest.languages.find(({ id }) => id === "python")!;
  python.hermetic.reproducibilityMatrixIds = ["python-artifact"];
  assert.throws(
    () => proveGraduatedLanguageCoverage(manifest, successfulComparisons),
    /protected wasm route evidence/,
  );
});
