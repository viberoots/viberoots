import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree, probeCopyFileCloneSupportFrom } from "../../../lib/copy-tree.ts";
import "./worker-init";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;

type SeedDeps = {
  rsyncRepoTo: (dst: string) => Promise<void>;
  timeAsync: TimeAsync;
};

type RepoInitMode = "rsync" | "seed-store";

const requiredFiles = ["flake.nix", path.join("tools", "buck", "export-graph.ts")];
const CLONE_PROBE_LABEL = "seedStore clone probe (copyFileCloneSupport)";

let seedStoreCloneMode: "try" | "none" | null = null;
let seedStoreCloneModePromise: Promise<"try" | "none"> | null = null;

function isVerifyMode(): boolean {
  return Boolean(process.env.BNX_VERIFY_LOCK_DIR || process.env.BNX_VERIFY_LOG_FILE);
}

function wantsFilteredRsync(): boolean {
  return (
    String(process.env.TEST_RSYNC_ROOTS || "").trim() !== "" ||
    String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || "").trim() === "1" ||
    String(process.env.TEST_EXCLUDE_CPP_REQS || "").trim() === "1"
  );
}

async function assertRequiredFiles(dir: string, label: string): Promise<void> {
  const missing: string[] = [];
  for (const rel of requiredFiles) {
    try {
      await fsp.access(path.join(dir, rel));
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length) {
    throw new Error(`runInTemp: ${label} missing ${missing.join(", ")}`);
  }
}

async function requireSeedPath(seedPath: string, seedKey: string): Promise<void> {
  const st = await fsp.stat(seedPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    const hint = seedKey ? `seed key: ${seedKey}` : "seed key: <missing>";
    throw new Error(`runInTemp: seed store path missing: ${seedPath}\n${hint}\nrerun v`);
  }
}

async function seedStoreCloneModeOncePerWorker(args: {
  timeAsync: TimeAsync;
  seedPath: string;
  tmpDir: string;
}): Promise<"try" | "none"> {
  if (seedStoreCloneMode) return seedStoreCloneMode;
  if (!seedStoreCloneModePromise) {
    seedStoreCloneModePromise = (async () => {
      const srcFile = path.join(args.seedPath, "flake.nix");
      const supported = await args.timeAsync(CLONE_PROBE_LABEL, async () => {
        return await probeCopyFileCloneSupportFrom({
          srcFile,
          dstDir: args.tmpDir,
          cloneMode: "try",
        });
      });
      seedStoreCloneMode = supported ? "try" : "none";
      return seedStoreCloneMode;
    })();
  }
  return await seedStoreCloneModePromise;
}

export async function initTempRepoFromSeedStore(args: {
  tmpDir: string;
  deps: SeedDeps;
}): Promise<RepoInitMode> {
  const { tmpDir, deps } = args;
  const seedPath = String(process.env.BNX_TEST_SEED_STORE_PATH || "").trim();
  const seedKey = String(process.env.BNX_TEST_SEED_KEY || "").trim();
  if (wantsFilteredRsync()) {
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }
  if (!seedPath) {
    if (isVerifyMode()) {
      throw new Error("runInTemp: missing BNX_TEST_SEED_STORE_PATH; rerun v");
    }
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }
  await requireSeedPath(seedPath, seedKey);
  await assertRequiredFiles(seedPath, "seed store");
  const cloneMode = await seedStoreCloneModeOncePerWorker({
    timeAsync: deps.timeAsync,
    seedPath,
    tmpDir,
  });
  await deps.timeAsync(`seedStoreCopy(${path.basename(tmpDir)})`, async () => {
    await copyTree(seedPath, tmpDir, { cloneMode, force: true });
  });
  try {
    await $`bash --noprofile --norc -c ${`chmod -R u+w ${tmpDir} >/dev/null 2>&1 || true`}`;
  } catch {}
  await assertRequiredFiles(tmpDir, "seed copy");
  return "seed-store";
}
