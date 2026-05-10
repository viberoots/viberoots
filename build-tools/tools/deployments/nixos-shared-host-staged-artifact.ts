#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export const NIXOS_SHARED_HOST_UPLOAD_COMPLETE_MARKER = ".vbr-upload-complete.json";

export function stagedUploadTempPath(finalPath: string): string {
  return `${finalPath}.uploading`;
}

export function stagedUploadCompleteMarkerPath(finalPath: string): string {
  return path.join(path.dirname(finalPath), `${path.basename(finalPath)}.complete.json`);
}

function insideRoot(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function assertCompleteMarker(finalPath: string): Promise<void> {
  const markerPath = stagedUploadCompleteMarkerPath(finalPath);
  let marker;
  try {
    marker = await fsp.lstat(markerPath);
  } catch {
    throw new Error(`finalized staged artifact is missing completion marker: ${finalPath}`);
  }
  if (!marker.isFile()) {
    throw new Error(`finalized staged artifact completion marker is not a file: ${markerPath}`);
  }
}

async function assertImmutableTree(root: string, dir: string): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    const stat = await fsp.lstat(abs);
    if ((stat.mode & 0o222) !== 0) {
      throw new Error(`finalized staged artifact contains writable entry: ${rel}`);
    }
    if (entry.isDirectory()) await assertImmutableTree(root, abs);
  }
}

export async function assertFinalizedStagedArtifactPath(opts: {
  artifactDir: string;
  stagingRoot: string;
}): Promise<string> {
  if (!path.isAbsolute(opts.artifactDir)) {
    throw new Error("finalized staged artifact reference must be absolute");
  }
  const stagingRoot = await fsp.realpath(path.resolve(opts.stagingRoot));
  const artifactDir = await fsp.realpath(path.resolve(opts.artifactDir));
  if (!insideRoot(stagingRoot, artifactDir)) {
    throw new Error("finalized staged artifact must live under the configured staging root");
  }
  const stat = await fsp.lstat(artifactDir);
  if (!stat.isDirectory()) {
    throw new Error(`finalized staged artifact is not a directory: ${artifactDir}`);
  }
  await assertCompleteMarker(artifactDir);
  await assertImmutableTree(artifactDir, artifactDir);
  return artifactDir;
}
