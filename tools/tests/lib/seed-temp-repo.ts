import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;
type Zx$ = any;

type SeedDeps = {
  mktemp: (prefix?: string) => Promise<string>;
  rsyncRepoTo: (dst: string) => Promise<void>;
  timeAsync: TimeAsync;
  $: Zx$;
};

type SeedState = {
  seedKey: string;
  seedDir: string;
};

let seedState: SeedState | null = null;
let seedReady: Promise<SeedState> | null = null;

type CowMode = "darwin-cp-clone" | "linux-cp-reflink" | "none";
let cowModeReady: Promise<CowMode> | null = null;

function shortHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function seedConfigKey(): string {
  // If these toggles change mid-process, we must not reuse an old seed, because
  // the seed’s contents would no longer match the requested rsync shape.
  return JSON.stringify({
    TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
    TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
    TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
  });
}

function sharedSeedPaths(seedKey: string): {
  root: string;
  seedDir: string;
  readyMarker: string;
  lockFile: string;
} {
  const root = path.join(os.tmpdir(), "bucknix-seed-repo-cache");
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

async function tryCpCloneCowMode($: Zx$, mode: Exclude<CowMode, "none">): Promise<boolean> {
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-cow-probe-src-"));
  const dst = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-cow-probe-dst-"));
  try {
    await fsp.writeFile(path.join(src, "hello.txt"), "hello\n", "utf8");
    const darwinCp = "/bin/cp";
    const res =
      mode === "darwin-cp-clone"
        ? await $({ stdio: "pipe" })`${darwinCp} -cRp ${src}/. ${dst}/`.nothrow()
        : await $({ stdio: "pipe" })`cp -a --reflink=auto ${src}/. ${dst}/`.nothrow();
    return res.exitCode === 0;
  } finally {
    await fsp.rm(src, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
  }
}

async function detectCowModeOnce($: Zx$): Promise<CowMode> {
  if (cowModeReady) return await cowModeReady;
  cowModeReady = (async () => {
    if (process.platform === "darwin") {
      const ok = await tryCpCloneCowMode($, "darwin-cp-clone").catch(() => false);
      return ok ? "darwin-cp-clone" : "none";
    }
    if (process.platform === "linux") {
      const ok = await tryCpCloneCowMode($, "linux-cp-reflink").catch(() => false);
      return ok ? "linux-cp-reflink" : "none";
    }
    return "none";
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
  $: Zx$;
}): Promise<void> {
  const { seedDir, tmpDir, mode, $ } = opts;
  if (mode === "seed-cow") {
    if (process.platform === "darwin") {
      const cp = "/bin/cp";
      await $`${cp} -cRp ${seedDir}/. ${tmpDir}/`;
      return;
    }
    if (process.platform === "linux") {
      await $`cp -a --reflink=auto ${seedDir}/. ${tmpDir}/`;
      return;
    }
    throw new Error(`seed-cow clone requested on unsupported platform: ${process.platform}`);
  }
  if (mode === "seed-copy") {
    await $`cp -a ${seedDir}/. ${tmpDir}/`;
    return;
  }
  throw new Error(`unexpected clone mode: ${mode}`);
}

export async function initTempRepoFromWorkspaceOrSeed(args: {
  tmpDir: string;
  deps: SeedDeps;
}): Promise<RepoInitMode> {
  const { tmpDir, deps } = args;

  const cow = await deps.timeAsync("seedRepo.detectCowMode", async () => detectCowModeOnce(deps.$));
  const mode = selectInitMode(cow);

  if (mode === "rsync") {
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }

  const seed = await deps.timeAsync("seedRepo.ensureSeedRepo", async () =>
    ensureSeedRepoOnce(deps),
  );
  await deps.timeAsync(`cloneSeedRepoTo(${path.basename(tmpDir)})`, async () =>
    cloneSeedToTemp({ seedDir: seed.seedDir, tmpDir, mode, $: deps.$ }),
  );
  return mode;
}
