import fs from "node:fs/promises";
import path from "node:path";
import { RELEASE_BUILDER_SYSTEMS } from "../lib/artifact-reproducibility-matrix";
import type { ProtectedRustPatchEvidence } from "./protected-rust-patch-evidence";

export async function readArtifactCellManifests(root: string, name: string): Promise<string[]> {
  return (
    await Promise.all(
      RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
        ["one", "two"].map(async (slot) =>
          (await fs.readFile(path.join(root, `cell-${system}-${slot}`, name), "utf8"))
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ),
    )
  ).flat();
}

export async function readProtectedRustPatchEvidenceFiles(
  root: string,
): Promise<ProtectedRustPatchEvidence[]> {
  return await Promise.all(
    RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
      ["one", "two"].map(
        async (slot) =>
          JSON.parse(
            await fs.readFile(path.join(root, `public-rust-patch-${system}-${slot}.json`), "utf8"),
          ) as ProtectedRustPatchEvidence,
      ),
    ),
  );
}
