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

function findNearestImporterAttr(): string | null {
  let here = process.cwd();
  const root = here;
  while (true) {
    const lock = path.join(here, "pnpm-lock.yaml");
    const rel = path.relative(root, here);
    const looksImporter = rel.startsWith("apps/") || rel.startsWith("libs/");
    if (looksImporter) {
      return rel.replace(/[\/ :]+/g, "_");
    }
    const next = path.dirname(here);
    if (next === here) break;
    here = next;
  }
  // Fallback to default/root importer when no apps/libs importer is found
  return "default";
}

export async function relinkNodeModules(force: boolean) {
  const attr = findNearestImporterAttr();
  let outPath = "";
  if (attr) {
    const { stdout } = await $`nix eval --raw .#node-modules.${attr}.outPath`.nothrow();
    outPath = String(stdout).trim();
    if (!outPath) {
      await $`nix build .#node-modules.${attr} --no-link --accept-flake-config`;
      const { stdout: s2 } = await $`nix eval --raw .#node-modules.${attr}.outPath`.nothrow();
      outPath = String(s2).trim();
    }
  }
  if (!outPath) {
    const { stdout } =
      await $`nix build .#node-modules.default --no-link --accept-flake-config --print-out-paths`;
    outPath = String(stdout).trim();
  }
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
