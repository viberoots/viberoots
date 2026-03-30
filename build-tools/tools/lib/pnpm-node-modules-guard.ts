import * as fsp from "node:fs/promises";
import path from "node:path";

async function pathExists(target: string): Promise<boolean> {
  return await fsp
    .lstat(target)
    .then(() => true)
    .catch(() => false);
}

export async function withHiddenNodeModules<T>(
  importerAbs: string,
  fn: () => Promise<T>,
): Promise<T> {
  const nodeModulesAbs = path.join(importerAbs, "node_modules");
  if (!(await pathExists(nodeModulesAbs))) return await fn();

  const hiddenAbs = path.join(
    importerAbs,
    `.node_modules.lockfile-guard.${process.pid}.${Date.now()}`,
  );
  await fsp.rename(nodeModulesAbs, hiddenAbs);
  try {
    return await fn();
  } finally {
    if (await pathExists(nodeModulesAbs)) {
      await fsp.rm(nodeModulesAbs, { recursive: true, force: true }).catch(() => {});
    }
    if (await pathExists(hiddenAbs)) {
      await fsp.rename(hiddenAbs, nodeModulesAbs).catch(() => {});
    }
  }
}
