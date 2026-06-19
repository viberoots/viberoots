import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import {
  sharedExactPnpmStateIndexPath,
  sharedExactPnpmStateRoot,
  sharedExactPnpmStateRootPath,
} from "../../lib/pnpm-state-paths";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard";
import { runExactStoreCommand } from "./exact-store-command";
import { importExactStoreIntoNixStore } from "./exact-store-import";
import { cleanupLocalWorkspaceMarker, ensureLocalWorkspaceMarker } from "./lockfile-shared";
import { syncSourcePnpmStoreIntoLocalPrefetch } from "./prefetched-store";

const EXACT_STORE_CACHE_VERSION = 5;

async function sha256HexFile(absPath: string): Promise<string> {
  const buf = await fsp.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function pruneSupersededExactStoreForImporter(
  importer: string,
  lockHash: string,
): Promise<void> {
  const indexPath = sharedExactPnpmStateIndexPath(importer);
  try {
    const raw = await fsp.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as { lockHash?: string };
    const previousLockHash = String(parsed.lockHash || "").trim();
    if (previousLockHash && previousLockHash !== lockHash) {
      await fsp.rm(sharedExactPnpmStateRootPath(previousLockHash), {
        recursive: true,
        force: true,
      });
    }
  } catch {}
  await fsp.mkdir(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(
    tmp,
    JSON.stringify({ version: EXACT_STORE_CACHE_VERSION, importer, lockHash }, null, 2) + "\n",
    "utf8",
  );
  await fsp.rename(tmp, indexPath);
}

async function removeExactStoreArchive(cacheDir: string): Promise<void> {
  await fsp.rm(path.join(cacheDir, "archive"), { recursive: true, force: true }).catch(() => {});
}

async function withExactStoreLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const waitTimeoutMs =
    Number.parseInt(process.env.VBR_EXACT_PNPM_STORE_LOCK_WAIT_TIMEOUT_MS || "900000", 10) ||
    900000;
  const staleAgeMs =
    Number.parseInt(process.env.VBR_EXACT_PNPM_STORE_LOCK_STALE_AGE_MS || "900000", 10) || 900000;
  const startedAt = Date.now();
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
          JSON.stringify({ pid: process.pid, startedAtMs: Date.now() }),
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
        throw new Error(`timed out waiting for exact pnpm store lock: ${lockPath}`);
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

export async function prepareExactPnpmStore(opts: {
  repoRoot: string;
  importer: string;
}): Promise<{ storeDir: string; exactStorePath: string; cleanup: () => Promise<void> }> {
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const lockfileAbs = path.join(importerAbs, "pnpm-lock.yaml");
  if (!fs.existsSync(lockfileAbs)) {
    throw new Error(`exact pnpm store prefetch requires a committed lockfile: ${lockfileAbs}`);
  }
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  const lockHash = await sha256HexFile(lockfileAbs);
  const cacheDir = await sharedExactPnpmStateRoot(lockHash);
  await pruneSupersededExactStoreForImporter(opts.importer, lockHash);
  const storeDir = path.join(cacheDir, "store");
  const homeDir = path.join(cacheDir, "home");
  const markerPath = path.join(cacheDir, "ready.json");
  const lockPath = path.join(cacheDir, ".prepare.lock");
  const readMarker = async (): Promise<{
    version: number;
    lockHash: string;
    nixStorePath: string;
  } | null> => {
    try {
      const raw = await fsp.readFile(markerPath, "utf8");
      const parsed = JSON.parse(raw) as {
        version?: number;
        lockHash?: string;
        nixStorePath?: string;
      };
      const nixStorePath = String(parsed.nixStorePath || "").trim();
      if (
        parsed.version !== EXACT_STORE_CACHE_VERSION ||
        parsed.lockHash !== lockHash ||
        !fs.existsSync(storeDir) ||
        !nixStorePath ||
        !fs.existsSync(nixStorePath)
      ) {
        return null;
      }
      return {
        version: EXACT_STORE_CACHE_VERSION,
        lockHash,
        nixStorePath,
      };
    } catch {
      return null;
    }
  };
  let preparedMarker = await readMarker();
  await fsp.mkdir(cacheDir, { recursive: true });
  await withExactStoreLock(lockPath, async () => {
    preparedMarker = await readMarker();
    if (preparedMarker) return;
    const { workspaceFileAbs, hadLocalWorkspaceFile } =
      await ensureLocalWorkspaceMarker(importerAbs);
    try {
      // These live under the per-lockfile exact-store cache root, not the user's HOME.
      await removeExactStoreArchive(cacheDir);
      await fsp.rm(storeDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(homeDir, { recursive: true, force: true }).catch(() => {});
      await fsp.mkdir(homeDir, { recursive: true });
      await fsp.mkdir(storeDir, { recursive: true });
      const pnpmPath = ensureNixStoreToolPathSync("pnpm");
      await withHiddenNodeModules(importerAbs, async () => {
        await runExactStoreCommand({
          command: pnpmPath,
          label: `importer=${opts.importer} step=exact-store-fetch`,
          cwd: importerAbs,
          timeoutMs,
          env: {
            ...process.env,
            NIX_PNPM_ALLOW_GENERATE: "1",
            NIX_PNPM_FETCH_TIMEOUT: fetchTimeout,
            NIX_PNPM_INSTALL_TIMEOUT: fetchTimeout,
            PNPM_HOME: homeDir,
          },
          args: [
            "fetch",
            "--force",
            "--frozen-lockfile",
            "--prefer-offline",
            "--prod=false",
            "--lockfile-dir",
            ".",
            "--dir",
            ".",
            "--store-dir",
            storeDir,
            "--color",
            "never",
          ],
        });
      });
      await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
      const nixStorePath = await importExactStoreIntoNixStore({
        repoRoot: opts.repoRoot,
        importer: opts.importer,
        storeDir,
        timeoutMs,
      });
      await fsp.writeFile(
        markerPath,
        JSON.stringify(
          {
            version: EXACT_STORE_CACHE_VERSION,
            lockHash,
            nixStorePath,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      preparedMarker = {
        version: EXACT_STORE_CACHE_VERSION,
        lockHash,
        nixStorePath,
      };
    } catch (error) {
      await fsp.rm(markerPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
    }
  });
  if (!preparedMarker) {
    throw new Error(`exact pnpm store marker missing after preparation for ${opts.importer}`);
  }
  return { storeDir, exactStorePath: preparedMarker.nixStorePath, cleanup: async () => {} };
}
export async function withExactPrefetchedStore<T>(
  opts: { repoRoot: string; importer: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const prepared = await prepareExactPnpmStore(opts);
  try {
    return await fn({
      ...process.env,
      NIX_PNPM_EXACT_STORE: prepared.exactStorePath,
    });
  } finally {
    await prepared.cleanup();
  }
}
