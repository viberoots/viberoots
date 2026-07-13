import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

async function pathExists(target: string): Promise<boolean> {
  return await fsp
    .lstat(target)
    .then(() => true)
    .catch(() => false);
}

function sanitizeFragment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "root";
}

function nearestRepoRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

async function hiddenNodeModulesPath(importerAbs: string): Promise<string> {
  const repoRoot = nearestRepoRoot(importerAbs);
  const rel = path.relative(repoRoot, importerAbs) || ".";
  const hiddenRoot = path.join(repoRoot, ".viberoots", "workspace", "node-modules-hidden");
  await fsp.mkdir(hiddenRoot, { recursive: true });
  return path.join(hiddenRoot, `${sanitizeFragment(rel)}.${process.pid}.${Date.now()}`);
}

export async function withHiddenNodeModules<T>(
  importerAbs: string,
  fn: () => Promise<T>,
): Promise<T> {
  const nodeModulesAbs = path.join(importerAbs, "node_modules");
  const nodeModulesStat = await fsp.lstat(nodeModulesAbs).catch(() => null);
  const hadNodeModules = !!nodeModulesStat;
  const hiddenAbs = hadNodeModules ? await hiddenNodeModulesPath(importerAbs) : "";
  if (hiddenAbs) await fsp.rename(nodeModulesAbs, hiddenAbs);
  try {
    return await fn();
  } finally {
    if (await pathExists(nodeModulesAbs)) {
      await fsp.rm(nodeModulesAbs, { recursive: true, force: true }).catch(() => {});
    }
    if (hiddenAbs && (await pathExists(hiddenAbs))) {
      await fsp.rename(hiddenAbs, nodeModulesAbs).catch(() => {});
    }
  }
}
