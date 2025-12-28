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

function seedConfigKey(): string {
  // If these toggles change mid-process, we must not reuse an old seed, because
  // the seed’s contents would no longer match the requested rsync shape.
  return JSON.stringify({
    TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
    TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
    TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
  });
}

async function tryCpCloneCowMode($: Zx$, mode: Exclude<CowMode, "none">): Promise<boolean> {
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-cow-probe-src-"));
  const dst = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-cow-probe-dst-"));
  try {
    await fsp.writeFile(path.join(src, "hello.txt"), "hello\n", "utf8");
    const res =
      mode === "darwin-cp-clone"
        ? await $({ stdio: "pipe" })`cp -cRp ${src}/. ${dst}/`.nothrow()
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

  // If config changed, deliberately drop the old seed and create a new one.
  // Cleanup is best-effort; the old seed is still isolated under tmpdir anyway.
  if (seedState && seedState.seedKey !== key) {
    const old = seedState.seedDir;
    fsp.rm(old, { recursive: true, force: true }).catch(() => {});
  }

  if (seedReady) {
    const s = await seedReady;
    if (s.seedKey === key) return s;
  }

  seedReady = (async () => {
    const seedDir = await deps.mktemp("seed-");
    await deps.rsyncRepoTo(seedDir);
    const s: SeedState = { seedKey: key, seedDir };
    seedState = s;

    // Best-effort cleanup when the worker process exits (unless explicitly keeping tmp dirs).
    process.once("exit", () => {
      if (process.env.TEST_KEEP_TMP === "1") return;
      fsp.rm(seedDir, { recursive: true, force: true }).catch(() => {});
    });

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
      await $`cp -cRp ${seedDir}/. ${tmpDir}/`;
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
