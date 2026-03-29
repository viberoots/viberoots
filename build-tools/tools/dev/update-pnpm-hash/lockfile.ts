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
      await fsp.writeFile(workspaceFileAbs, "packages:\n  - ./\n", "utf8");
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
  await runLockfileCommandsWithGcRetry({
    importerAbs,
    flakeRef,
    timeoutMs,
    fetchTimeout,
    homeDir,
    storeDir,
  });
  if (!usesSharedPrefetch) {
    await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
  }

  await seedImporterLockfileFromRootIfNeeded({ repoRoot: opts.repoRoot, importerAbs });
  await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
  console.log(`[lockfile] done: ${path.join(opts.importer, "pnpm-lock.yaml")}`);
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
