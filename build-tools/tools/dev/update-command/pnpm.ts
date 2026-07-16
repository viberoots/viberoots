import * as fsp from "node:fs/promises";
import path from "node:path";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import { mkdtempNoindex } from "../../lib/macos-metadata";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard";
import { resolveRepoNodeBin } from "../../lib/repo-node-bin";
import {
  cleanupLocalWorkspaceMarker,
  ensureLocalWorkspaceMarker,
} from "../update-pnpm-hash/lockfile-shared";
import { findWorkspacePackageDirs } from "../update-pnpm-hash/importer-workspace-packages";
import { runCommand } from "../filtered-flake-command";

export function pnpmLockArgs(upgrade: boolean, storeDir: string): string[] {
  const operation = upgrade ? ["update", "--latest"] : ["install", "--prefer-offline"];
  return [
    ...operation,
    "--lockfile-only",
    ...(upgrade ? [] : ["--prod=false"]),
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--lockfile-dir",
    ".",
    "--dir",
    ".",
    "--store-dir",
    storeDir,
    "--network-concurrency",
    "1",
    ...(upgrade ? [] : ["--child-concurrency", "1"]),
    "--reporter",
    "append-only",
  ];
}

export async function updatePnpmLock(opts: {
  root: string;
  importer: string;
  upgrade: boolean;
}): Promise<void> {
  const importerAbs = path.resolve(opts.root, opts.importer);
  const packages = await findWorkspacePackageDirs({ repoRoot: opts.root, importerAbs });
  const marker = await ensureLocalWorkspaceMarker(importerAbs, packages);
  const temp = await mkdtempNoindex("vbr-update-pnpm-", { baseName: "update-pnpm" });
  try {
    await withHiddenNodeModules(importerAbs, async () => {
      await runCommand({
        command: process.env.UPDATE_PNPM_BIN || "pnpm",
        args: pnpmLockArgs(opts.upgrade, path.join(temp, "store")),
        cwd: importerAbs,
        env: { ...externalNodeToolEnv(), PNPM_HOME: path.join(temp, "home") },
      });
    });
    const prettier = await resolveRepoNodeBin(opts.root, "prettier");
    await runCommand({
      command: prettier,
      args: ["--write", path.join(importerAbs, "pnpm-lock.yaml")],
      cwd: opts.root,
      env: externalNodeToolEnv(),
    });
  } finally {
    await cleanupLocalWorkspaceMarker({
      workspaceFileAbs: marker.workspaceFileAbs,
      hadLocalWorkspaceFile: marker.hadLocalWorkspaceFile,
    });
    await fsp.rm(temp, { recursive: true, force: true });
  }
}
