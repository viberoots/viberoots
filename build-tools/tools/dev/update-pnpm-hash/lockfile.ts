import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { gcWaitConfig, waitForNoActiveNixGc } from "../../lib/nix-gc-lock.ts";
import { importerLockfileNeedsRegen } from "../../lib/pnpm-importer-lockfile.ts";

async function waitForNixGcToClearForLockfile(): Promise<void> {
  const cfg = gcWaitConfig();
  let lastLogAt = 0;
  const stillActive = await waitForNoActiveNixGc({
    timeoutMs: cfg.timeoutMs,
    pollMs: cfg.pollMs,
    onWait: (pids, elapsedMs, timeoutMs) => {
      if (elapsedMs - lastLogAt < 15_000) return;
      lastLogAt = elapsedMs;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const timeoutSec = Math.floor(timeoutMs / 1000);
      console.warn(
        `[lockfile] waiting for active nix gc to finish (${pids.join(", ")}); elapsed=${elapsedSec}s timeout=${timeoutSec}s`,
      );
    },
  });
  if (stillActive.length > 0) {
    throw new Error(
      `lockfile generation blocked: active 'nix store gc' process(es) detected (${stillActive.join(", ")}). Stop GC and rerun 'scaf new ...'.`,
    );
  }
}

function pnpmFlakeRef(repoRoot: string): string {
  // Keep path: so newly scaffolded/untracked files are visible to flake evaluation.
  return `path:${path.resolve(repoRoot)}#pnpm`;
}

function localPnpmDirs(importerAbs: string): { homeDir: string; storeDir: string } {
  return {
    homeDir: path.join(importerAbs, ".pnpm-home"),
    storeDir: path.join(importerAbs, ".pnpm-store"),
  };
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
  await waitForNixGcToClearForLockfile();

  const { workspaceFileAbs, hadLocalWorkspaceFile } = await ensureLocalWorkspaceMarker(importerAbs);
  const fetchTimeout = String(process.env.NIX_PNPM_FETCH_TIMEOUT || "").trim() || "600";
  const timeoutMs = (Number.parseInt(fetchTimeout, 10) || 600) * 1000 + 120_000;
  const { homeDir, storeDir } = localPnpmDirs(importerAbs);
  await fsp.mkdir(homeDir, { recursive: true }).catch(() => {});
  await fsp.mkdir(storeDir, { recursive: true }).catch(() => {});
  const flakeRef = pnpmFlakeRef(opts.repoRoot);
  console.log(`[lockfile] generating importer lockfile: ${opts.importer}`);
  await $({
    cwd: importerAbs,
    stdio: "inherit",
    timeout: timeoutMs,
    env: {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      NIX_PNPM_FETCH_TIMEOUT: fetchTimeout,
      PNPM_HOME: homeDir,
    },
  })`nix run --accept-flake-config ${flakeRef} -- install --lockfile-only --prod=false --ignore-scripts --lockfile-dir . --dir . --store-dir ${storeDir} --color never`;

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
