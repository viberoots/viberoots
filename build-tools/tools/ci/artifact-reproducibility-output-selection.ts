import { reproducibilityMatrixCase } from "../lib/artifact-reproducibility-matrix";
import type { ArtifactReproducibilitySubjectAuthority } from "../lib/artifact-reproducibility-evidence";

type RunNix = (args: string[]) => Promise<{ stdout: string }>;

export async function buildArtifactOutputPair(
  flakeRef: string,
  subjectAuthority: ArtifactReproducibilitySubjectAuthority,
  runNix: RunNix,
): Promise<{ outputPath: string; provenanceOutputPath: string }> {
  const outputPath = onlyPath(
    (await runNix(["build", "--no-link", "--print-out-paths", `${flakeRef}^out`])).stdout,
  );
  const splitProvenance =
    subjectAuthority.kind === "matrix" &&
    subjectAuthority.artifactFamily === "rust" &&
    reproducibilityMatrixCase(subjectAuthority.matrixId).graphSelection.requiredLabels.some(
      (label) => label === "kind:wasm" || label === "kind:wasi_static",
    );
  const provenanceOutputPath = splitProvenance
    ? onlyPath(
        (await runNix(["build", "--no-link", "--print-out-paths", `${flakeRef}^provenance`]))
          .stdout,
      )
    : outputPath;
  return { outputPath, provenanceOutputPath };
}

function onlyPath(stdout: string): string {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1 || !values[0]!.startsWith("/nix/store/")) {
    throw new Error("artifact build must produce exactly one Nix store path");
  }
  return values[0]!;
}
