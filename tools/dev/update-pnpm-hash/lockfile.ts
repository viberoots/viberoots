import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function ensureLocalWorkspaceMarker(importerAbs: string): Promise<{
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}> {
  const workspaceFileAbs = path.join(importerAbs, "pnpm-workspace.yaml");
  const hadLocalWorkspaceFile = fs.existsSync(workspaceFileAbs);
  try {
    if (!hadLocalWorkspaceFile) {
      await fsp.mkdir(importerAbs, { recursive: true });
      await fsp.writeFile(workspaceFileAbs, "packages:\n  - ./\n", "utf8");
    }
  } catch {}
  return { workspaceFileAbs, hadLocalWorkspaceFile };
}

async function cleanupLocalWorkspaceMarker(opts: {
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}) {
  try {
    if (!opts.hadLocalWorkspaceFile && fs.existsSync(opts.workspaceFileAbs)) {
      await fsp.rm(opts.workspaceFileAbs).catch(() => {});
    }
  } catch {}
}

async function seedImporterLockfileFromRootIfNeeded(opts: {
  repoRoot: string;
  importerAbs: string;
}) {
  const importerLockfileAbs = path.join(opts.importerAbs, "pnpm-lock.yaml");
  try {
    const rootLock = path.join(opts.repoRoot, "pnpm-lock.yaml");
    if (!fs.existsSync(importerLockfileAbs) && fs.existsSync(rootLock)) {
      await fsp.mkdir(path.dirname(importerLockfileAbs), { recursive: true });
      await fsp.copyFile(rootLock, importerLockfileAbs);
    }
  } catch {}
}

export async function generateImporterLockfile(opts: { repoRoot: string; importer: string }) {
  // Generate a lockfile in the importer; keep scripts disabled and include dev deps.
  // Ensure pnpm uses a writable local store/cache. Run from importer root to avoid
  // pnpm choosing the workspace root implicitly and write lockfile to importer dir.
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);

  const { workspaceFileAbs, hadLocalWorkspaceFile } = await ensureLocalWorkspaceMarker(importerAbs);
  await $({
    cwd: importerAbs,
    stdio: "inherit",
  })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p ".pnpm-home" ".pnpm-store"; export PNPM_HOME="$(pwd)/.pnpm-home"; nix run --accept-flake-config "path:${opts.repoRoot}#pnpm" -- config set store-dir "$(pwd)/.pnpm-store"; nix run --accept-flake-config "path:${opts.repoRoot}#pnpm" -- install --lockfile-only --prod=false --ignore-scripts --lockfile-dir "." --dir "." --color never'`;

  await seedImporterLockfileFromRootIfNeeded({ repoRoot: opts.repoRoot, importerAbs });
  await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
}
