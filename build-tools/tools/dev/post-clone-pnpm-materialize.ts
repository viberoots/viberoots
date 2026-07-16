#!/usr/bin/env zx-wrapper
import path from "node:path";
import { runNodeWithZx } from "../lib/node-run";
import { findRepoRoot } from "../lib/repo";
import { buildToolPath, zxInitPath } from "./dev-build/paths";
import { discoverImportersWithLock } from "./install/importers";

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const updater = buildToolPath(repoRoot, "tools/dev/update-pnpm-hash.ts");
  const importers = await discoverImportersWithLock(repoRoot, { cwd: repoRoot });
  for (const importer of importers) {
    const lockfile = importer === "." ? "pnpm-lock.yaml" : path.join(importer, "pnpm-lock.yaml");
    await runNodeWithZx({
      nodeBin: process.execPath,
      zxInitPath: zxInitPath(repoRoot),
      script: updater,
      args: ["--lockfile", lockfile, "--materialize-committed"],
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, WORKSPACE_ROOT: repoRoot, BUCK_TEST_SRC: repoRoot },
    });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
