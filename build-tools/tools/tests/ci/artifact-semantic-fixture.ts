import type { ArtifactReproducibilityEvidence } from "../../lib/artifact-reproducibility-evidence";
import type { ARTIFACT_REPRODUCIBILITY_MATRIX } from "../../lib/artifact-reproducibility-matrix";

type MatrixCase = (typeof ARTIFACT_REPRODUCIBILITY_MATRIX)[number];
type Subject = ArtifactReproducibilityEvidence["subjectAuthority"];

export function semanticForSubject(
  subject: Subject,
  outputPath: string,
  digest: string,
): ArtifactReproducibilityEvidence["semanticManifest"] {
  if (subject.kind !== "matrix" || subject.artifactFamily !== "rust") {
    return { kind: "not-applicable" };
  }
  return semanticForRustMatrix(subject.matrixId, outputPath, digest);
}

export function semanticForMatrixCase(
  matrixCase: MatrixCase,
  outputPath: string,
  digest: string,
): Partial<ArtifactReproducibilityEvidence> {
  if (matrixCase.artifactFamily !== "rust") return {};
  return { semanticManifest: semanticForRustMatrix(matrixCase.id, outputPath, digest) };
}

function semanticForRustMatrix(
  matrixId: string,
  outputPath: string,
  digest: string,
): Exclude<ArtifactReproducibilityEvidence["semanticManifest"], { kind: "not-applicable" }> {
  if (matrixId === "rust-tauri-darwin-pr12") {
    return {
      kind: "tauri-artifact-manifest",
      storePath: `${outputPath}/share/viberoots-tauri/artifact-manifest.json`,
      digest,
    };
  }
  if (matrixId === "rust-pyodide-extension-pr14") {
    return {
      kind: "python-wasm-materialization-manifest",
      storePath: `${outputPath}/share/viberoots-python-wasm/materialization-manifest.json`,
      digest,
    };
  }
  return {
    kind: "rust-materialization-manifest",
    storePath: `${outputPath}/share/viberoots-rust/materialization-manifest.json`,
    digest,
  };
}
