import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { activeNixGcPids, gcWaitConfig, waitForNoActiveNixGc } from "../../lib/nix-gc-lock.ts";
import { importerLockfileNeedsRegen } from "../../lib/pnpm-importer-lockfile.ts";
import {
  externalPnpmStateDirs,
  removeLegacyImporterPnpmState,
} from "../../lib/pnpm-state-paths.ts";
import {
  syncLocalPrefetchIntoPnpmStore,
  syncSourcePnpmStoreIntoLocalPrefetch,
} from "./prefetched-store.ts";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard.ts";

function preferredPnpmStoreDir(defaultStoreDir: string): {
  storeDir: string;
  usesSharedPrefetch: boolean;
} {
  const localPrefetch = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (localPrefetch) {
    return { storeDir: localPrefetch, usesSharedPrefetch: true };
  }
  return { storeDir: defaultStoreDir, usesSharedPrefetch: false };
}

const PNPM_WORKSPACE_MARKER = [
  "packages:",
  "  - ./",
  "supportedArchitectures:",
  "  os:",
  "    - darwin",
  "    - linux",
  "    - win32",
  "  cpu:",
  "    - x64",
  "    - arm64",
  "    - arm",
  "  libc:",
  "    - glibc",
  "    - musl",
  "",
].join("\n");

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

async function runLockfileCommandsWithGcRetry(opts: {
  importerAbs: string;
  flakeRef: string;
  timeoutMs: number;
  fetchTimeout: string;
  homeDir: string;
  storeDir: string;
}): Promise<void> {
  const runPnpm = async (...args: string[]) =>
    await $({
      cwd: opts.importerAbs,
      stdio: "inherit",
      timeout: opts.timeoutMs,
      env: {
        ...process.env,
        NIX_PNPM_ALLOW_GENERATE: "1",
        NIX_PNPM_FETCH_TIMEOUT: opts.fetchTimeout,
        PNPM_HOME: opts.homeDir,
      },
    })`nix run --accept-flake-config ${opts.flakeRef} -- ${args}`;

  const runCommands = async () => {
    await runPnpm(
      "install",
      "--force",
      "--lockfile-only",
      "--prefer-offline",
      "--prod=false",
      "--ignore-scripts",
      "--lockfile-dir",
      ".",
      "--dir",
      ".",
      "--store-dir",
      opts.storeDir,
      "--color",
      "never",
    );
    await runPnpm(
      "fetch",
      "--force",
      "--prefer-offline",
      "--prod=false",
      "--lockfile-dir",
      ".",
      "--dir",
      ".",
      "--store-dir",
      opts.storeDir,
      "--color",
      "never",
    );
  };

  try {
    await runCommands();
    return;
  } catch (error) {
    const gcPids = activeNixGcPids();
    if (gcPids.length === 0) throw error;
    const cfg = gcWaitConfig();
    console.warn(
      `[lockfile] install failed while nix gc active (${gcPids.join(", ")}); waiting for gc completion and retrying once`,
    );
    const stillActive = await waitForNoActiveNixGc({
      timeoutMs: cfg.timeoutMs,
      pollMs: cfg.pollMs,
    });
    if (stillActive.length > 0) {
      throw new Error(
        `lockfile generation blocked after install failure: active 'nix store gc' process(es) still running (${stillActive.join(", ")}). Stop GC and rerun 'scaf new ...'.`,
      );
    }
    await runCommands();
  }
}

function pnpmFlakeRef(repoRoot: string): string {
  // Keep path: so newly scaffolded/untracked files are visible to flake evaluation.
  return `path:${path.resolve(repoRoot)}#pnpm`;
}

export async function makeFilteredFlakeRef(repoRoot: string): Promise<{
  flakeRef: string;
  cleanup: () => Promise<void>;
}> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "scaf-flake-"));
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const src = path.resolve(repoRoot);
  // Keep untracked scaffold outputs while excluding large generated directories.
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules --exclude buck-out --exclude .direnv --exclude .pnpm-store --exclude .pnpm-home --exclude coverage --exclude .clinic --exclude .turbo --exclude .cache ${src}/ ${snapDir}/`;
  return {
    flakeRef: pnpmFlakeRef(snapDir),
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function ensureLocalWorkspaceMarker(importerAbs: string): Promise<{
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}> {
  const workspaceFileAbs = path.join(importerAbs, "pnpm-workspace.yaml");
  const hadLocalWorkspaceFile = fs.existsSync(workspaceFileAbs);
  try {
    if (!hadLocalWorkspaceFile) {
      await fsp.mkdir(importerAbs, { recursive: true });
      await fsp.writeFile(workspaceFileAbs, PNPM_WORKSPACE_MARKER, "utf8");
    }
  } catch {}
  return { workspaceFileAbs, hadLocalWorkspaceFile };
}

async function cleanupLocalWorkspaceMarker(opts: {
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}) {
  try {
    if (!opts.hadLocalWorkspaceFile && fs.existsSync(opts.workspaceFileAbs)) {
      await fsp.rm(opts.workspaceFileAbs).catch(() => {});
    }
  } catch {}
}

async function seedImporterLockfileFromRootIfNeeded(opts: {
  repoRoot: string;
  importerAbs: string;
}) {
  const importerLockfileAbs = path.join(opts.importerAbs, "pnpm-lock.yaml");
  try {
    const rootLock = path.join(opts.repoRoot, "pnpm-lock.yaml");
    if (!fs.existsSync(importerLockfileAbs) && fs.existsSync(rootLock)) {
      await fsp.mkdir(path.dirname(importerLockfileAbs), { recursive: true });
      await fsp.copyFile(rootLock, importerLockfileAbs);
    }
  } catch {}
}

export async function generateImporterLockfile(opts: { repoRoot: string; importer: string }) {
  // Generate a lockfile in the importer; keep scripts disabled and include dev deps.
  // Ensure pnpm uses a writable local store/cache. Run from importer root to avoid
  // pnpm choosing the workspace root implicitly and write lockfile to importer dir.
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const { workspaceFileAbs, hadLocalWorkspaceFile } = await ensureLocalWorkspaceMarker(importerAbs);
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  await removeLegacyImporterPnpmState(importerAbs);
  const { homeDir, storeDir: externalStoreDir } = await externalPnpmStateDirs(importerAbs);
  const { storeDir, usesSharedPrefetch } = preferredPnpmStoreDir(externalStoreDir);
  if (!usesSharedPrefetch) {
    await syncLocalPrefetchIntoPnpmStore(storeDir);
  }
  const flakeRef = pnpmFlakeRef(opts.repoRoot);
  console.log(`[lockfile] generating importer lockfile: ${opts.importer}`);
  await withHiddenNodeModules(importerAbs, async () => {
    await runLockfileCommandsWithGcRetry({
      importerAbs,
      flakeRef,
      timeoutMs,
      fetchTimeout,
      homeDir,
      storeDir,
    });
  });
  if (!usesSharedPrefetch) {
    await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
  }

  await seedImporterLockfileFromRootIfNeeded({ repoRoot: opts.repoRoot, importerAbs });
  await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
  console.log(`[lockfile] done: ${path.join(opts.importer, "pnpm-lock.yaml")}`);
}

export async function prepareExactPnpmStore(opts: { repoRoot: string; importer: string }): Promise<{
  storeDir: string;
  cleanup: () => Promise<void>;
}> {
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
      const parsed = JSON.parse(raw) as {
        version?: number;
        importer?: string;
        lockHash?: string;
      };
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

export async function ensureImporterLockfileFreshIfAllowed(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  const allowGenerate = String(process.env.NIX_PNPM_ALLOW_GENERATE || "").trim() === "1";
  if (!allowGenerate) return;
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const importerLock = path.join(importerAbs, "pnpm-lock.yaml");
  const missing = !fs.existsSync(importerLock);
  const stale = !missing
    ? await importerLockfileNeedsRegen({
        repoRootAbs: opts.repoRoot,
        importerRel: opts.importer,
      }).catch(() => true)
    : true;
  if (missing || stale) {
    await generateImporterLockfile(opts);
  }
}

export async function ensureImporterLockfileFresh(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const importerLock = path.join(importerAbs, "pnpm-lock.yaml");
  const missing = !fs.existsSync(importerLock);
  const stale = !missing
    ? await importerLockfileNeedsRegen({
        repoRootAbs: opts.repoRoot,
        importerRel: opts.importer,
      }).catch(() => true)
    : true;
  if (missing || stale) {
    await generateImporterLockfile(opts);
  }
}
