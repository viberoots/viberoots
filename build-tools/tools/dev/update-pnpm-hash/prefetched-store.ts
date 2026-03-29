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
  await fsp.chmod(dst, 0o755).catch(() => {});
}

async function removeExistingTarget(target: string): Promise<void> {
  const cur = await fsp.lstat(target).catch(() => null);
  if (!cur) return;
  if (cur.isDirectory() && !cur.isSymbolicLink()) {
    await fsp.rm(target, { recursive: true, force: true });
    return;
  }
  await fsp.chmod(target, 0o644).catch(() => {});
  await fsp.rm(target, { force: true }).catch(() => {});
}

async function copyResolvedFile(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.chmod(path.dirname(target), 0o755).catch(() => {});
  await removeExistingTarget(target);
  await fsp.copyFile(source, target);
  const st = await fsp.stat(source);
  await fsp.chmod(target, st.mode);
}

async function mergeResolvedTree(source: string, target: string): Promise<void> {
  const st = await fsp.stat(source);
  if (st.isDirectory()) {
    await fsp.mkdir(target, { recursive: true });
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await mergeSymlinkSafe(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  await copyResolvedFile(source, target);
}

async function mergeSymlinkSafe(source: string, target: string): Promise<void> {
  const lst = await fsp.lstat(source);
  if (lst.isSymbolicLink()) {
    const real = await fsp.realpath(source);
    await mergeResolvedTree(real, target);
    return;
  }
  if (lst.isDirectory()) {
    await ensureMergedDir(target);
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await mergeSymlinkSafe(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  await copyResolvedFile(source, target);
}

function lockPathForStore(storePath: string): string {
  return path.join(path.dirname(storePath), ".sync.lock");
}

async function withStoreLock<T>(storePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = lockPathForStore(storePath);
  const startedAt = Date.now();
  const waitTimeoutMs =
    Number.parseInt(process.env.BNX_PNPM_STORE_SYNC_LOCK_WAIT_TIMEOUT_MS || "900000", 10) || 900000;
  const staleAgeMs =
    Number.parseInt(process.env.BNX_PNPM_STORE_SYNC_LOCK_STALE_AGE_MS || "900000", 10) || 900000;

  const pidAlive = (pid: number): boolean => {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const readLockMeta = async (): Promise<{ pid: number | null; startedAtMs: number | null }> => {
    try {
      const txt = (await fsp.readFile(lockPath, "utf8")).trim();
      if (!txt) return { pid: null, startedAtMs: null };
      const parsed = JSON.parse(txt);
      const pid = Number.isFinite(parsed?.pid) ? Number(parsed.pid) : null;
      const startedAtMs = Number.isFinite(parsed?.startedAtMs) ? Number(parsed.startedAtMs) : null;
      return { pid, startedAtMs };
    } catch {
      return { pid: null, startedAtMs: null };
    }
  };

  while (true) {
    try {
      const handle = await fsp.open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            startedAtMs: Date.now(),
          }),
          "utf8",
        );
        return await fn();
      } finally {
        await handle.close().catch(() => {});
        await fsp.rm(lockPath, { force: true }).catch(() => {});
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      if (Date.now() - startedAt > waitTimeoutMs) {
        throw new Error(`timed out waiting for pnpm store sync lock: ${lockPath}`);
      }
      const meta = await readLockMeta();
      if (meta.pid !== null && !pidAlive(meta.pid)) {
        await fsp.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      try {
        const st = await fsp.stat(lockPath);
        const ageMs = Math.max(
          Date.now() - st.mtimeMs,
          meta.startedAtMs ? Date.now() - meta.startedAtMs : 0,
        );
        if (ageMs > staleAgeMs) {
          await fsp.rm(lockPath, { force: true }).catch(() => {});
          continue;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function mergePnpmStore(sourceStore: string, targetStore: string): Promise<void> {
  await withStoreLock(targetStore, async () => {
    await syncPnpmStore(sourceStore, targetStore);
  });
}

export async function syncSourcePnpmStoreIntoLocalPrefetch(sourceStore: string): Promise<void> {
  const localStore = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (!localStore) return;
  await withStoreLock(localStore, async () => {
    await syncPnpmStore(sourceStore, localStore);
  });
}

export async function syncLocalPrefetchIntoPnpmStore(targetStore: string): Promise<void> {
  const localStore = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (!localStore) return;
  await withStoreLock(localStore, async () => {
    await syncPnpmStore(localStore, targetStore);
  });
}

async function syncPnpmStore(sourceStore: string, targetStore: string): Promise<void> {
  if (!(await dirExists(sourceStore))) return;
  if (path.resolve(sourceStore) === path.resolve(targetStore)) return;
  await fsp.mkdir(targetStore, { recursive: true });
  const entries = await fsp.readdir(sourceStore, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("v")) continue;
    const srcVer = path.join(sourceStore, entry.name);
    const dstVer = path.join(targetStore, entry.name);
    await fsp.mkdir(dstVer, { recursive: true });
    const srcFiles = path.join(srcVer, "files");
    const dstFiles = path.join(dstVer, "files");
    if (await dirExists(srcFiles)) {
      await ensureMergedDir(dstFiles);
      await mergeSymlinkSafe(srcFiles, dstFiles);
    }
    const srcIndex = path.join(srcVer, "index");
    const dstIndex = path.join(dstVer, "index");
    if (await dirExists(srcIndex)) {
      await ensureMergedDir(dstIndex);
      await mergeSymlinkSafe(srcIndex, dstIndex);
    }
  }
}

export async function syncBuiltPnpmStoreIntoLocalPrefetch(storeOutPath: string): Promise<void> {
  await syncSourcePnpmStoreIntoLocalPrefetch(path.join(storeOutPath, "store"));
}
