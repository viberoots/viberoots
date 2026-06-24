import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  sharedExactPnpmStateIndexPath,
  sharedExactPnpmStateRoot,
  sharedExactPnpmStateRootPath,
} from "../../lib/pnpm-state-paths";
import { resolveWorkspaceRootsSync } from "../../lib/repo";
import { fetchExactPnpmStore } from "./exact-store-fetch";
import { importExactStoreIntoNixStore } from "./exact-store-import";
import { cleanupLocalWorkspaceMarker, ensureLocalWorkspaceMarker } from "./lockfile-shared";
import { syncSourcePnpmStoreIntoLocalPrefetch } from "./prefetched-store";

const EXACT_STORE_CACHE_VERSION = 11;

function canonicalFlakeRoot(root: string): string {
  const abs = path.resolve(root);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function resolveFlakePnpmProgram(repoRoot: string): string {
  const flakeRoot = canonicalFlakeRoot(repoRoot);
  const system = execFileSync(
    "nix",
    ["eval", "--impure", "--raw", "--expr", "builtins.currentSystem"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  ).trim();
  const program = execFileSync(
    "nix",
    [
      "eval",
      "--accept-flake-config",
      "--impure",
      "--raw",
      `path:${flakeRoot}#apps.${system}.pnpm.program`,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
    },
  ).trim();
  if (program.startsWith("/nix/store/") && !fs.existsSync(program)) {
    execFileSync(
      "nix",
      ["run", "--accept-flake-config", "--impure", `path:${flakeRoot}#pnpm`, "--", "--version"],
      {
        encoding: "utf8",
        timeout: 120_000,
        stdio: "pipe",
      },
    );
  }
  if (!program.startsWith("/nix/store/") || !fs.existsSync(program)) {
    throw new Error(`resolved flake pnpm program is not a realized /nix/store path: ${program}`);
  }
  return program;
}

function tempViberootsRootFromEnv(): string | null {
  for (const candidate of [process.env.VIBEROOTS_SOURCE_ROOT, process.env.VIBEROOTS_ROOT]) {
    const root = String(candidate || "").trim();
    if (
      root &&
      path.isAbsolute(root) &&
      fs.existsSync(path.join(root, "flake.nix")) &&
      fs.existsSync(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))
    ) {
      return canonicalFlakeRoot(root);
    }
  }
  return null;
}

async function sha256HexFile(absPath: string): Promise<string> {
  const buf = await fsp.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function pruneSupersededExactStoreForImporter(
  repoRoot: string,
  importer: string,
  lockHash: string,
): Promise<void> {
  const indexPath = sharedExactPnpmStateIndexPath(repoRoot, importer);
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
    JSON.stringify(
      {
        version: EXACT_STORE_CACHE_VERSION,
        repoRoot: path.resolve(repoRoot),
        importer,
        lockHash,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fsp.rename(tmp, indexPath);
}

async function removeExactStoreArchive(cacheDir: string): Promise<void> {
  await fsp.rm(path.join(cacheDir, "archive"), { recursive: true, force: true }).catch(() => {});
}

async function removeRedundantLocalExactStoreDirs(opts: {
  storeDir: string;
  homeDir: string;
}): Promise<void> {
  await fsp.rm(opts.storeDir, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(opts.homeDir, { recursive: true, force: true }).catch(() => {});
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
  viberootsRoot?: string;
}): Promise<{ storeDir: string; exactStorePath: string; cleanup: () => Promise<void> }> {
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const lockfileAbs = path.join(importerAbs, "pnpm-lock.yaml");
  if (!fs.existsSync(lockfileAbs)) {
    throw new Error(`exact pnpm store prefetch requires a committed lockfile: ${lockfileAbs}`);
  }
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  const lockHash = await sha256HexFile(lockfileAbs);
  const rootEnv = { ...process.env, WORKSPACE_ROOT: opts.repoRoot };
  const roots = resolveWorkspaceRootsSync({ start: opts.repoRoot, env: rootEnv });
  const pnpmPath = resolveFlakePnpmProgram(
    opts.viberootsRoot || tempViberootsRootFromEnv() || roots.viberootsRoot,
  );
  const cacheDir = await sharedExactPnpmStateRoot(lockHash);
  await pruneSupersededExactStoreForImporter(opts.repoRoot, opts.importer, lockHash);
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
      await fetchExactPnpmStore({
        importer: opts.importer,
        importerAbs,
        storeDir,
        homeDir,
        fetchTimeout,
        timeoutMs,
        pnpmPath,
      });
      await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
      const nixStorePath = await importExactStoreIntoNixStore({
        repoRoot: opts.repoRoot,
        importer: opts.importer,
        storeDir,
        timeoutMs,
      });
      await removeRedundantLocalExactStoreDirs({ storeDir, homeDir });
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
  await removeRedundantLocalExactStoreDirs({ storeDir, homeDir });
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
