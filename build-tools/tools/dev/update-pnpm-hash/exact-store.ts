import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { externalPnpmStateDirs } from "../../lib/pnpm-state-paths.ts";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard.ts";
import {
  cleanupLocalWorkspaceMarker,
  ensureLocalWorkspaceMarker,
  pnpmFlakeRef,
} from "./lockfile-shared.ts";

const EXACT_STORE_CACHE_VERSION = 1;

async function sha256HexFile(absPath: string): Promise<string> {
  const buf = await fsp.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function withExactStoreLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const waitTimeoutMs =
    Number.parseInt(process.env.BNX_EXACT_PNPM_STORE_LOCK_WAIT_TIMEOUT_MS || "900000", 10) ||
    900000;
  const staleAgeMs =
    Number.parseInt(process.env.BNX_EXACT_PNPM_STORE_LOCK_STALE_AGE_MS || "900000", 10) || 900000;
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
}): Promise<{ storeDir: string; cleanup: () => Promise<void> }> {
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const lockfileAbs = path.join(importerAbs, "pnpm-lock.yaml");
  if (!fs.existsSync(lockfileAbs)) {
    throw new Error(`exact pnpm store prefetch requires a committed lockfile: ${lockfileAbs}`);
  }

  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  const lockHash = await sha256HexFile(lockfileAbs);
  const { rootDir } = await externalPnpmStateDirs(importerAbs);
  const cacheDir = path.join(rootDir, "exact", lockHash);
  const storeDir = path.join(cacheDir, "store");
  const homeDir = path.join(cacheDir, "home");
  const markerPath = path.join(cacheDir, "ready.json");
  const lockPath = path.join(cacheDir, ".prepare.lock");
  const flakeRef = pnpmFlakeRef(opts.repoRoot);
  const markerMatches = async (): Promise<boolean> => {
    try {
      const raw = await fsp.readFile(markerPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: number; importer?: string; lockHash?: string };
      return (
        parsed.version === EXACT_STORE_CACHE_VERSION &&
        parsed.importer === opts.importer &&
        parsed.lockHash === lockHash &&
        fs.existsSync(storeDir)
      );
    } catch {
      return false;
    }
  };

  await fsp.mkdir(cacheDir, { recursive: true });
  await withExactStoreLock(lockPath, async () => {
    if (await markerMatches()) return;
    const { workspaceFileAbs, hadLocalWorkspaceFile } =
      await ensureLocalWorkspaceMarker(importerAbs);
    try {
      await fsp.rm(storeDir, { recursive: true, force: true }).catch(() => {});
      await fsp.mkdir(homeDir, { recursive: true });
      await fsp.mkdir(storeDir, { recursive: true });
      await withHiddenNodeModules(importerAbs, async () => {
        const prefetched = await $({
          cwd: importerAbs,
          stdio: "pipe",
          timeout: timeoutMs,
          env: {
            ...process.env,
            NIX_PNPM_ALLOW_GENERATE: "1",
            NIX_PNPM_FETCH_TIMEOUT: fetchTimeout,
            NIX_PNPM_INSTALL_TIMEOUT: fetchTimeout,
            PNPM_HOME: homeDir,
          },
        })`nix run --accept-flake-config ${flakeRef} -- fetch --force --frozen-lockfile --prefer-offline --prod=false --lockfile-dir . --dir . --store-dir ${storeDir} --color never`.nothrow();
        const stdout = String(prefetched.stdout || "");
        const stderr = String(prefetched.stderr || "");
        if (stdout) process.stderr.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (prefetched.exitCode !== 0) {
          throw new Error(
            stderr.trim() || stdout.trim() || `exact pnpm store fetch failed for ${opts.importer}`,
          );
        }
      });
      await fsp.writeFile(
        markerPath,
        JSON.stringify(
          {
            version: EXACT_STORE_CACHE_VERSION,
            importer: opts.importer,
            lockHash,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
    } catch (error) {
      await fsp.rm(storeDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(markerPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
    }
  });
  return { storeDir, cleanup: async () => {} };
}

export async function withExactPrefetchedStore<T>(
  opts: { repoRoot: string; importer: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const prepared = await prepareExactPnpmStore(opts);
  try {
    return await fn({
      ...process.env,
      NIX_PNPM_EXACT_STORE: prepared.storeDir,
    });
  } finally {
    await prepared.cleanup();
  }
}
