#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function relinkNodeModules(force: boolean) {
  const { stdout } =
    await $`nix build .#node-modules --no-link --accept-flake-config --print-out-paths`;
  const outPath = String(stdout).trim();
  if (!outPath) return;
  const linkTarget = path.join(outPath, "node_modules");
  const nm = path.join(process.cwd(), "node_modules");
  const existsNm = await exists(nm);
  if (existsNm && !(await fsp.lstat(nm)).isSymbolicLink()) {
    if (!force) {
      console.error("node_modules exists and is not a symlink. Use --force to replace.");
      process.exit(2);
    }
    await fsp.rm(nm, { recursive: true, force: true });
  }
  await fsp.symlink(linkTarget, nm).catch(async () => {
    await fsp.rm(nm, { recursive: true, force: true }).catch(() => {});
    await fsp.symlink(linkTarget, nm);
  });
}
