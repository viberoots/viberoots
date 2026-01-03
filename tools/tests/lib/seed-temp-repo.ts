import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { $ } from "zx";
import { copyTree, probeCopyFileCloneSupport } from "../../lib/copy-tree.ts";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;

type SeedDeps = {
  mktemp: (prefix?: string) => Promise<string>;
  rsyncRepoTo: (dst: string) => Promise<void>;
  timeAsync: TimeAsync;
};

type SeedState = {
  seedKey: string;
  seedDir: string;
};

let seedState: SeedState | null = null;
let seedReady: Promise<SeedState> | null = null;

type CowMode = "copyfile-clone" | "none";
let cowModeReady: Promise<CowMode> | null = null;

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function seedConfigKey(): string {
  // If these toggles change mid-process, we must not reuse an old seed, because
  // the seed’s contents would no longer match the requested rsync shape.
  return JSON.stringify({
    // Bump when seed layout/contents rules change, to avoid reusing an old incompatible seed dir.
    SEED_VERSION: "2",
    TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
    TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
    TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
  });
}

function stableSeedCacheRoot(): string {
  // Important: avoid caching under os.tmpdir(), because in nix-shell / nix develop environments
  // TMPDIR can be set to a per-invocation directory like .../T/nix-shell.<random>/, which defeats
  // caching and can cause large run-to-run variance.
  //
  // Use a stable per-user directory under /tmp on Unix, falling back to os.tmpdir() elsewhere.
  if (process.platform === "win32") return os.tmpdir();
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  return path.join(base, `bucknix-seed-repo-cache${suffix}`);
}

function sharedSeedPaths(seedKey: string): {
  root: string;
  seedDir: string;
  readyMarker: string;
  lockFile: string;
} {
  const root = stableSeedCacheRoot();
  const h = shortHash(seedKey);
  const seedDir = path.join(root, `seed-${h}`);
  const readyMarker = path.join(seedDir, ".ready");
  const lockFile = path.join(root, `seed-${h}.lock`);
  return { root, seedDir, readyMarker, lockFile };
}

async function waitForReadyMarker(readyMarker: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fsp.access(readyMarker);
      return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function ensureSharedSeedRepo(deps: SeedDeps, seedKey: string): Promise<string> {
  const { root, seedDir, readyMarker, lockFile } = sharedSeedPaths(seedKey);
  await fsp.mkdir(root, { recursive: true });

  try {
    await fsp.access(readyMarker);
    return seedDir;
  } catch {}

  let lockFd: fsp.FileHandle | null = null;
  try {
    lockFd = await fsp.open(lockFile, "wx");
  } catch {
    const ok = await waitForReadyMarker(readyMarker, 60_000);
    if (ok) return seedDir;
    throw new Error(`seed repo lock held too long (missing ready marker): ${lockFile}`);
  }

  try {
    try {
      await fsp.rm(seedDir, { recursive: true, force: true });
    } catch {}
    const tmpDir = await fsp.mkdtemp(path.join(root, `seed-${shortHash(seedKey)}.tmp-`));
    await deps.rsyncRepoTo(tmpDir);
    // Defensive: ensure volatile Buck scratch directories never enter the seed.
    // (They can be huge and may be mutated/cleaned concurrently by Buck.)
    try {
      await fsp.rm(path.join(tmpDir, ".buck"), { recursive: true, force: true });
    } catch {}
    try {
      await fsp.rm(path.join(tmpDir, ".cache"), { recursive: true, force: true });
    } catch {}
    // Make the seed repo a committed git worktree once per process/config.
    // Many tests intentionally run `nix build .#...` in temp repos; when a directory is a git repo,
    // Nix uses a git snapshot of tracked files. Committing the seed once allows temp repos to inherit
    // a consistent tracked-files baseline without paying per-temp `git add -A` overhead.
    try {
      const $seed = $({ cwd: tmpDir, stdio: "pipe" });
      await $seed`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
      await $seed`git add -A`;
      await $seed`git -c user.name=seed -c user.email=seed@example.com commit -q -m seed --allow-empty`.nothrow();
    } catch {
      throw new Error(
        "seed-temp-repo: failed to initialize seed repo as git (required for deterministic nix builds)",
      );
    }
    // Ready marker is a cache coordination primitive; do not track it in git.
    await fsp.writeFile(path.join(tmpDir, ".ready"), "ok\n", "utf8");
    await fsp.rename(tmpDir, seedDir);
    return seedDir;
  } finally {
    try {
      await lockFd.close();
    } catch {}
    await fsp.rm(lockFile, { force: true }).catch(() => {});
  }
}

async function detectCowModeOnce(): Promise<CowMode> {
  if (cowModeReady) return await cowModeReady;
  cowModeReady = (async () => {
    const ok = await probeCopyFileCloneSupport().catch(() => false);
    return ok ? "copyfile-clone" : "none";
  })();
  return await cowModeReady;
}

async function ensureSeedRepoOnce(deps: SeedDeps): Promise<SeedState> {
  const key = seedConfigKey();
  if (seedState && seedState.seedKey === key) return seedState;

  if (seedReady) {
    const s = await seedReady;
    if (s.seedKey === key) return s;
  }

  seedReady = (async () => {
    const seedDir = await ensureSharedSeedRepo(deps, key);
    const s: SeedState = { seedKey: key, seedDir };
    seedState = s;

    return s;
  })();

  return await seedReady;
}

type RepoInitMode = "rsync" | "seed-cow" | "seed-copy";

function selectInitMode(cow: CowMode): RepoInitMode {
  if (process.env.TEST_DISABLE_SEED_REPO === "1") return "rsync";
  if (process.env.TEST_FORCE_SEED_REPO === "1") return cow === "none" ? "seed-copy" : "seed-cow";
  return cow === "none" ? "rsync" : "seed-cow";
}

async function cloneSeedToTemp(opts: {
  seedDir: string;
  tmpDir: string;
  mode: RepoInitMode;
}): Promise<void> {
  const { seedDir, tmpDir, mode } = opts;
  if (mode === "seed-cow") {
    await copyTree(seedDir, tmpDir, { cloneMode: "try", force: true });
    return;
  }
  if (mode === "seed-copy") {
    await copyTree(seedDir, tmpDir, { cloneMode: "none", force: true });
    return;
  }
  throw new Error(`unexpected clone mode: ${mode}`);
}

export async function initTempRepoFromWorkspaceOrSeed(args: {
  tmpDir: string;
  deps: SeedDeps;
}): Promise<RepoInitMode> {
  const { tmpDir, deps } = args;

  const cow = await deps.timeAsync("seedRepo.detectCowMode", async () => detectCowModeOnce());
  const mode = selectInitMode(cow);

  if (mode === "rsync") {
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }

  const seed = await deps.timeAsync("seedRepo.ensureSeedRepo", async () =>
    ensureSeedRepoOnce(deps),
  );
  await deps.timeAsync(`cloneSeedRepoTo(${path.basename(tmpDir)})`, async () =>
    cloneSeedToTemp({ seedDir: seed.seedDir, tmpDir, mode }),
  );
  return mode;
}
