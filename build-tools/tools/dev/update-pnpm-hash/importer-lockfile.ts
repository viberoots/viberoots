import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { activeNixGcPids, gcWaitConfig, waitForNoActiveNixGc } from "../../lib/nix-gc-lock";
import { importerLockfileNeedsRegen } from "../../lib/pnpm-importer-lockfile";
import { externalPnpmStateDirs, removeLegacyImporterPnpmState } from "../../lib/pnpm-state-paths";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard";
import {
  syncLocalPrefetchIntoPnpmStore,
  syncSourcePnpmStoreIntoLocalPrefetch,
} from "./prefetched-store";
import {
  cleanupLocalWorkspaceMarker,
  ensureLocalWorkspaceMarker,
  pnpmFlakeRef,
  preferredPnpmStoreDir,
} from "./lockfile-shared";

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
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const { workspaceFileAbs, hadLocalWorkspaceFile } = await ensureLocalWorkspaceMarker(importerAbs);
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  await removeLegacyImporterPnpmState(importerAbs);
  const { homeDir, storeDir: externalStoreDir } = await externalPnpmStateDirs(importerAbs);
  const { storeDir, usesSharedPrefetch } = preferredPnpmStoreDir(externalStoreDir);
  if (!usesSharedPrefetch) await syncLocalPrefetchIntoPnpmStore(storeDir);
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
  if (!usesSharedPrefetch) await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
  await seedImporterLockfileFromRootIfNeeded({ repoRoot: opts.repoRoot, importerAbs });
  await cleanupLocalWorkspaceMarker({ workspaceFileAbs, hadLocalWorkspaceFile });
  console.log(`[lockfile] done: ${path.join(opts.importer, "pnpm-lock.yaml")}`);
}

async function needsFreshImporterLockfile(opts: { repoRoot: string; importer: string }) {
  const importerAbs = path.resolve(opts.repoRoot, opts.importer);
  const importerLock = path.join(importerAbs, "pnpm-lock.yaml");
  const missing = !fs.existsSync(importerLock);
  const stale = !missing
    ? await importerLockfileNeedsRegen({
        repoRootAbs: opts.repoRoot,
        importerRel: opts.importer,
      }).catch(() => true)
    : true;
  return missing || stale;
}

export async function ensureImporterLockfileFreshIfAllowed(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  const allowGenerate = String(process.env.NIX_PNPM_ALLOW_GENERATE || "").trim() === "1";
  if (allowGenerate && (await needsFreshImporterLockfile(opts))) {
    await generateImporterLockfile(opts);
  }
}

export async function ensureImporterLockfileFresh(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  if (await needsFreshImporterLockfile(opts)) {
    await generateImporterLockfile(opts);
  }
}
