import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

export function preferredPnpmStoreDir(defaultStoreDir: string): {
  storeDir: string;
  usesSharedPrefetch: boolean;
} {
  const localPrefetch = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (localPrefetch) {
    return { storeDir: localPrefetch, usesSharedPrefetch: true };
  }
  return { storeDir: defaultStoreDir, usesSharedPrefetch: false };
}

const PNPM_WORKSPACE_MARKER = [
  "packages:",
  "  - ./",
  "supportedArchitectures:",
  "  os:",
  "    - darwin",
  "    - linux",
  "    - win32",
  "  cpu:",
  "    - x64",
  "    - arm64",
  "    - arm",
  "  libc:",
  "    - glibc",
  "    - musl",
  "",
].join("\n");

export function pnpmFlakeRef(repoRoot: string): string {
  // Keep path: so newly scaffolded/untracked files are visible to flake evaluation.
  return `path:${path.resolve(repoRoot)}#pnpm`;
}

export async function ensureLocalWorkspaceMarker(importerAbs: string): Promise<{
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}> {
  const workspaceFileAbs = path.join(importerAbs, "pnpm-workspace.yaml");
  const hadLocalWorkspaceFile = fs.existsSync(workspaceFileAbs);
  try {
    if (!hadLocalWorkspaceFile) {
      await fsp.mkdir(importerAbs, { recursive: true });
      await fsp.writeFile(workspaceFileAbs, PNPM_WORKSPACE_MARKER, "utf8");
    }
  } catch {}
  return { workspaceFileAbs, hadLocalWorkspaceFile };
}

export async function cleanupLocalWorkspaceMarker(opts: {
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}) {
  try {
    if (!opts.hadLocalWorkspaceFile && fs.existsSync(opts.workspaceFileAbs)) {
      await fsp.rm(opts.workspaceFileAbs).catch(() => {});
    }
  } catch {}
}
