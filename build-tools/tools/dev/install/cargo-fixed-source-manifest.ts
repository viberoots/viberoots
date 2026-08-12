import * as fsp from "node:fs/promises";
import path from "node:path";
import { workspaceCargoHome } from "./cargo-home";
import type { FixedSourceMap } from "./cargo-fixed-sources";

export function fixedSourceManifestPath(root: string): string {
  return path.join(workspaceCargoHome(root), "viberoots-fixed-sources.json");
}

export async function fixedSourceManifestMatches(
  root: string,
  expected: FixedSourceMap,
): Promise<boolean> {
  const file = fixedSourceManifestPath(root);
  const actual = await fsp
    .readFile(file, "utf8")
    .then((bytes) => JSON.parse(bytes) as FixedSourceMap)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
    return false;
  }
  for (const [key, entry] of Object.entries(expected)) {
    const reviewed = actual[key];
    if (
      !reviewed ||
      reviewed.originPath !== entry.originPath ||
      reviewed.source !== entry.source ||
      reviewed.checksum !== entry.checksum
    ) {
      return false;
    }
    if (
      (entry.source.startsWith("registry+") || entry.source.startsWith("git+")) &&
      (!reviewed.storePath?.startsWith("/nix/store/") || !reviewed.narHash?.startsWith("sha256-"))
    ) {
      return false;
    }
    if (
      (entry.source.startsWith("registry+") || entry.source.startsWith("git+")) &&
      (!reviewed.buildInput ||
        reviewed.buildInput.source !== entry.source ||
        reviewed.buildInput.checksum !== entry.checksum ||
        reviewed.buildInput.storePath !== reviewed.storePath ||
        reviewed.buildInput.narHash !== reviewed.narHash)
    ) {
      return false;
    }
  }
  return true;
}
