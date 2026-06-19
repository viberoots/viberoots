import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  activeNixGcPids,
  gcWaitConfig,
  nixGcLockMessage,
  waitForNoActiveNixGc,
} from "../../lib/nix-gc-lock";
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
import { findWorkspacePackageDirs } from "./importer-workspace-packages";
import { runPnpmCommandWithRetry } from "./pnpm-command-retry";

async function runLockfileCommandsWithGcRetry(opts: {
  importerAbs: string;
  flakeRef: string;
  viberootsOverride: string;
  timeoutMs: number;
  fetchTimeout: string;
  homeDir: string;
  storeDir: string;
}): Promise<void> {
  const nixRunPrefix = opts.viberootsOverride
    ? ["run", "--accept-flake-config", "--override-input", "viberoots", opts.viberootsOverride]
    : ["run", "--accept-flake-config"];
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
    })`nix ${nixRunPrefix} ${opts.flakeRef} -- ${args}`;

  const runCommands = async () => {
    const cfg = gcWaitConfig();
    const gcPids = await waitForNoActiveNixGc({
      timeoutMs: cfg.timeoutMs,
      pollMs: cfg.pollMs,
    });
    if (gcPids.length > 0) {
      throw new Error(nixGcLockMessage("lockfile generation", gcPids));
    }
    await runPnpmCommandWithRetry(
      "install",
      () =>
        runPnpm(
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
          "--ignore-workspace-root-check",
          "--color",
          "never",
        ),
      { log: console.warn },
    );
    await runPnpmCommandWithRetry(
      "fetch",
      () =>
        runPnpm(
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
        ),
      { log: console.warn },
    );
  };

  try {
    await runCommands();
  } catch (error) {
    const gcPids = await activeNixGcPids();
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

async function activeViberootsOverride(repoRoot: string): Promise<string> {
  const candidates = [
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
  ]
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    try {
      if (
        fs.existsSync(path.join(abs, "flake.nix")) &&
        fs.existsSync(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs"))
      ) {
        const real = await fsp.realpath(abs).catch(() => abs);
        return `path:${real}`;
      }
    } catch {}
  }
  return "";
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
  const workspacePackages = await findWorkspacePackageDirs({
    repoRoot: opts.repoRoot,
    importerAbs,
  });
  const { workspaceFileAbs, hadLocalWorkspaceFile } = await ensureLocalWorkspaceMarker(
    importerAbs,
    workspacePackages,
  );
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  await removeLegacyImporterPnpmState(importerAbs);
  const { homeDir, storeDir: externalStoreDir } = await externalPnpmStateDirs(importerAbs);
  const { storeDir, usesSharedPrefetch } = preferredPnpmStoreDir(externalStoreDir);
  if (!usesSharedPrefetch) await syncLocalPrefetchIntoPnpmStore(storeDir);
  const flakeRef = pnpmFlakeRef(opts.repoRoot);
  const viberootsOverride = await activeViberootsOverride(opts.repoRoot);
  console.log(`[lockfile] generating importer lockfile: ${opts.importer}`);
  await withHiddenNodeModules(importerAbs, async () => {
    await runLockfileCommandsWithGcRetry({
      importerAbs,
      flakeRef,
      viberootsOverride,
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
