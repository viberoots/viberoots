import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactReproducibilityEvidence } from "../lib/artifact-reproducibility-evidence";

export async function readArtifactSemanticManifest(
  outputPath: string,
  subject: ArtifactReproducibilityEvidence["subjectAuthority"],
  readStoreFile: (storePath: string) => Promise<Buffer> = async (storePath) =>
    await fs.readFile(storePath),
  provenanceOutputPath: string = outputPath,
): Promise<ArtifactReproducibilityEvidence["semanticManifest"]> {
  if (subject.kind !== "matrix" || subject.matrixId !== "rust-tauri-darwin-pr12") {
    if (subject.kind !== "matrix" || subject.artifactFamily !== "rust") {
      return { kind: "not-applicable" };
    }
    const storePath = path.join(
      provenanceOutputPath,
      "share",
      "viberoots-rust",
      "materialization-manifest.json",
    );
    const bytes = await readStoreFile(storePath);
    const manifest = JSON.parse(bytes.toString("utf8")) as {
      schemaVersion?: unknown;
      storePaths?: unknown;
    };
    if (
      manifest.schemaVersion !== "viberoots.nix-store-materialization.v1" ||
      !Array.isArray(manifest.storePaths)
    ) {
      throw new Error("Rust matrix output lacks its semantic materialization manifest");
    }
    return {
      kind: "rust-materialization-manifest",
      storePath,
      digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    };
  }
  const storePath = path.join(outputPath, "share", "viberoots-tauri", "artifact-manifest.json");
  const bytes = await readStoreFile(storePath);
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    schema?: unknown;
    signature?: { releaseSigned?: unknown; releaseAdmitted?: unknown };
  };
  if (
    manifest.schema !== "viberoots.tauri-artifact.v1" ||
    manifest.signature?.releaseSigned !== false ||
    manifest.signature?.releaseAdmitted !== false
  ) {
    throw new Error("Tauri matrix output lacks its unsigned semantic artifact manifest");
  }
  return {
    kind: "tauri-artifact-manifest",
    storePath,
    digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export async function readRemoteNixStoreFile(
  runNix: (args: string[]) => Promise<{ stdout: string }>,
  storePath: string,
): Promise<Buffer> {
  if (!storePath.startsWith("/nix/store/")) {
    throw new Error("semantic manifest read requires an immutable Nix store path");
  }
  return Buffer.from((await runNix(["store", "cat", storePath])).stdout, "utf8");
}
