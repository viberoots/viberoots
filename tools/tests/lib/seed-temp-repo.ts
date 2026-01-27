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

async function isGitWorktree(): Promise<boolean> {
  try {
    const res = await $({
      cwd: process.cwd(),
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`git rev-parse --is-inside-work-tree`;
    return String(res.stdout || "").trim() == "true";
  } catch {
    return false;
  }
}

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

let workspaceDirtySigOnce: Promise<string> | null = null;
async function workspaceDirtySignature(): Promise<string> {
  // Robustness + speed: when the workspace is dirty, we still want to use a seed repo to avoid
  // paying the rsync cost for every temp repo. We do this by including a signature of the current
  // working tree state in the seed key, so a "dirty seed" is never reused across different edits.
  //
  // Note: this is a best-effort signature. If git is unavailable, fall back to a sentinel value
  // (which will still behave correctly; it just won't dedupe as effectively).
  if (workspaceDirtySigOnce) return await workspaceDirtySigOnce;
  workspaceDirtySigOnce = (async () => {
    try {
      const repoRoot = process.cwd();
      const status = await $({
        cwd: repoRoot,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`git status --porcelain=v1 -z`;
      if (status.exitCode !== 0) return "nogit";
      const s = String(status.stdout || "");
      if (!s) {
        const head = await $({
          cwd: repoRoot,
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`git rev-parse HEAD`;
        if (head.exitCode === 0) {
          const sha = String(head.stdout || "").trim();
          if (sha) return `clean:${sha}`;
        }
        return "clean";
      }
      const diff = await $({
        cwd: repoRoot,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`git diff --no-ext-diff`;
      const d = String(diff.stdout || "");
      return shortHash(s + "\n---\n" + d);
    } catch {
      return "nogit";
    }
  })();
  return await workspaceDirtySigOnce;
}

async function seedConfigKey(): Promise<string> {
  // If these toggles change mid-process, we must not reuse an old seed, because
  // the seed’s contents would no longer match the requested rsync shape.
  const dirtySig = await workspaceDirtySignature();
  return JSON.stringify({
    // Bump when seed layout/contents rules change, to avoid reusing an old incompatible seed dir.
    SEED_VERSION: "8",
    TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
    TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
    TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
    // Include working tree signature so we can safely seed from a dirty checkout once per run.
    WORKSPACE_DIRTY_SIG: dirtySig,
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
  seedTar: string;
} {
  const root = stableSeedCacheRoot();
  const h = shortHash(seedKey);
  const seedDir = path.join(root, `seed-${h}`);
  const seedTar = seedDir + ".tar";
  const readyMarker = path.join(seedDir, ".ready");
  const lockFile = path.join(root, `seed-${h}.lock`);
  return { root, seedDir, readyMarker, lockFile, seedTar };
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
  const { root, seedDir, readyMarker, lockFile, seedTar } = sharedSeedPaths(seedKey);
  await fsp.mkdir(root, { recursive: true });

  try {
    await fsp.access(readyMarker);
    try {
      await fsp.access(seedTar);
    } catch {
      try {
        const seedTarTmp = seedTar + ".tmp";
        await $`tar -cf ${seedTarTmp} -C ${seedDir} .`;
        await fsp.rename(seedTarTmp, seedTar);
      } catch {}
    }
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
    try {
      const seedTarTmp = seedTar + ".tmp";
      await $`tar -cf ${seedTarTmp} -C ${tmpDir} .`;
      await fsp.rename(seedTarTmp, seedTar);
    } catch {}
    await fsp.rename(tmpDir, seedDir);
    // Ready marker is a cache coordination primitive; do not track it in git.
    await fsp.writeFile(path.join(seedDir, ".ready"), "ok\n", "utf8");
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
  const key = await seedConfigKey();
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
  const seedTar = seedDir + ".tar";
  const requiredFiles = ["flake.nix", path.join("tools", "buck", "export-graph.ts")];
  const hasRequiredFiles = async (): Promise<boolean> => {
    for (const rel of requiredFiles) {
      try {
        await fsp.access(path.join(tmpDir, rel));
      } catch {
        return false;
      }
    }
    return true;
  };
  const ensureRequiredFiles = async (label: string) => {
    if (await hasRequiredFiles()) return;
    const missing: string[] = [];
    for (const rel of requiredFiles) {
      try {
        await fsp.access(path.join(tmpDir, rel));
      } catch {
        missing.push(rel);
      }
    }
    throw new Error(`seed-temp-repo: ${label} missing ${missing.join(", ")}`);
  };
  const tryTar = async (): Promise<boolean> => {
    try {
      await fsp.access(seedTar);
    } catch {
      return false;
    }
    try {
      await $`tar -xf ${seedTar} -C ${tmpDir}`;
      return await hasRequiredFiles();
    } catch {
      try {
        await fsp.rm(seedTar, { force: true });
      } catch {}
      return false;
    }
  };
  const tryShellClone = async (useCow: boolean): Promise<boolean> => {
    if (process.platform === "win32") return false;
    const src = path.join(seedDir, ".");
    const dst = path.join(tmpDir, ".");
    const run = async (flags: string[]): Promise<boolean> => {
      try {
        await $`cp ${flags} ${src} ${dst}`;
        return true;
      } catch {
        return false;
      }
    };
    if (useCow) {
      if (process.platform === "darwin") {
        if (await run(["-a", "-c"])) return true;
        return await run(["-a"]);
      }
      if (await run(["-a", "--reflink=auto"])) return true;
      if (await run(["-a", "-c"])) return true;
      return await run(["-a"]);
    }
    return await run(["-a"]);
  };
  if (mode === "seed-cow") {
    if (await tryTar()) {
      await ensureRequiredFiles("tar extraction");
      return;
    }
    if (!(await tryShellClone(true))) {
      await copyTree(seedDir, tmpDir, { cloneMode: "try", force: true });
    }
    await ensureRequiredFiles("seed-cow clone");
    return;
  }
  if (mode === "seed-copy") {
    if (await tryTar()) {
      await ensureRequiredFiles("tar extraction");
      return;
    }
    if (!(await tryShellClone(false))) {
      await copyTree(seedDir, tmpDir, { cloneMode: "none", force: true });
    }
    await ensureRequiredFiles("seed-copy clone");
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
  const mode0 = selectInitMode(cow);
  const mode = mode0;

  if (mode != "rsync" && process.env.TEST_FORCE_SEED_REPO != "1") {
    const hasGit = await deps.timeAsync("seedRepo.detectGit", async () => isGitWorktree());
    if (!hasGit) {
      await deps.rsyncRepoTo(tmpDir);
      return "rsync";
    }
  }

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
