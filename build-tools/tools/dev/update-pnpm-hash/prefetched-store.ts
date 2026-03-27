import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function ensureMergedDir(dst: string): Promise<void> {
  const cur = await fsp.lstat(dst).catch(() => null);
  if (!cur) {
    await fsp.mkdir(dst, { recursive: true });
    return;
  }
  if (cur.isSymbolicLink()) {
    const target = await fsp.realpath(dst).catch(() => "");
    await fsp.rm(dst, { force: true }).catch(() => {});
    await fsp.mkdir(dst, { recursive: true });
    if (target) {
      await fsp.cp(target, dst, { recursive: true }).catch(() => {});
    }
  }
}

export async function syncBuiltPnpmStoreIntoLocalPrefetch(storeOutPath: string): Promise<void> {
  const localStore = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (!localStore) return;
  const sourceStore = path.join(storeOutPath, "store");
  if (!(await dirExists(sourceStore))) return;
  await fsp.mkdir(localStore, { recursive: true });
  const entries = await fsp.readdir(sourceStore, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("v")) continue;
    const srcVer = path.join(sourceStore, entry.name);
    const dstVer = path.join(localStore, entry.name);
    await fsp.mkdir(dstVer, { recursive: true });
    const srcFiles = path.join(srcVer, "files");
    const dstFiles = path.join(dstVer, "files");
    if (await dirExists(srcFiles)) {
      if (!(await dirExists(dstFiles))) {
        const current = await fsp.lstat(dstFiles).catch(() => null);
        if (!current) {
          await fsp.symlink(srcFiles, dstFiles).catch(() => {});
        } else {
          await ensureMergedDir(dstFiles);
          await fsp.cp(srcFiles, dstFiles, { recursive: true }).catch(() => {});
        }
      } else {
        await ensureMergedDir(dstFiles);
        await fsp.cp(srcFiles, dstFiles, { recursive: true }).catch(() => {});
      }
    }
    const srcIndex = path.join(srcVer, "index");
    const dstIndex = path.join(dstVer, "index");
    if (await dirExists(srcIndex)) {
      await ensureMergedDir(dstIndex);
      await fsp.cp(srcIndex, dstIndex, { recursive: true }).catch(() => {});
    }
  }
}
