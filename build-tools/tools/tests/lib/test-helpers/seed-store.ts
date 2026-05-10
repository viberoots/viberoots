import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  assertRequiredSeedFiles,
  copySeedStoreToTempRepo,
  probeSeedCowCopyFrom,
} from "./seed-copy";
import "./worker-init";

type TimeAsync = <T>(label: string, fn: () => Promise<T>) => Promise<T>;

type SeedDeps = {
  rsyncRepoTo: (dst: string) => Promise<void>;
  timeAsync: TimeAsync;
};

type RepoInitMode = "rsync" | "seed-store";

const CLONE_PROBE_LABEL = "seedStore clone probe (copyFileCloneSupport)";
const WRITABLE_MARKER = ".seed-store-writable";

let seedStoreCowCopySupported: true | null = null;
let seedStoreCowCopySupportedPromise: Promise<true> | null = null;
let untrackedOverlayOncePerWorker: Promise<string[]> | null = null;
let trackedOverlayOncePerWorker: Promise<string[]> | null = null;
let overlayFilesOncePerWorker: Promise<string[]> | null = null;

function isVerifyMode(): boolean {
  return Boolean(process.env.VBR_VERIFY_LOCK_DIR || process.env.VBR_VERIFY_LOG_FILE);
}

function wantsFilteredRsync(): boolean {
  return (
    String(process.env.TEST_RSYNC_ROOTS || "").trim() !== "" ||
    String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || "").trim() === "1"
  );
}

async function requireSeedPath(seedPath: string, seedKey: string): Promise<void> {
  const st = await fsp.stat(seedPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    const hint = seedKey ? `seed key: ${seedKey}` : "seed key: <missing>";
    throw new Error(`runInTemp: seed store path missing: ${seedPath}\n${hint}\nrerun v`);
  }
}

async function isSeedStoreWritable(seedPath: string): Promise<boolean> {
  return await fsp
    .access(path.join(seedPath, WRITABLE_MARKER))
    .then(() => true)
    .catch(() => false);
}

async function listUntrackedFilesOncePerWorker(): Promise<string[]> {
  if (!untrackedOverlayOncePerWorker) {
    untrackedOverlayOncePerWorker = (async () => {
      const out = await $({
        stdio: "pipe",
        cwd: process.cwd(),
      })`git ls-files --others --exclude-standard`.nothrow();
      if (out.exitCode !== 0) return [];
      return String(out.stdout || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((rel) => rel.startsWith("build-tools/"))
        .sort((a, b) => a.localeCompare(b));
    })();
  }
  return await untrackedOverlayOncePerWorker;
}

async function listTrackedChangedFilesOncePerWorker(): Promise<string[]> {
  if (!trackedOverlayOncePerWorker) {
    trackedOverlayOncePerWorker = (async () => {
      const out = await $({
        stdio: "pipe",
        cwd: process.cwd(),
      })`git status --porcelain=v1 --untracked-files=no`.nothrow();
      if (out.exitCode !== 0) return [];
      const rels = String(out.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const raw = line.length >= 4 ? line.slice(3).trim() : "";
          if (!raw) return "";
          const renameSep = raw.indexOf(" -> ");
          return (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
        })
        .filter(Boolean)
        .filter((rel) => rel.startsWith("build-tools/"))
        .sort((a, b) => a.localeCompare(b));
      return Array.from(new Set(rels));
    })();
  }
  return await trackedOverlayOncePerWorker;
}

async function overlayUntrackedFilesIntoTempRepo(tmpDir: string): Promise<void> {
  const listOverlayFilesOncePerWorker = async (): Promise<string[]> => {
    if (!overlayFilesOncePerWorker) {
      overlayFilesOncePerWorker = (async () => {
        const [untrackedFiles, trackedChangedFiles] = await Promise.all([
          listUntrackedFilesOncePerWorker(),
          listTrackedChangedFilesOncePerWorker(),
        ]);
        const files = Array.from(new Set([...untrackedFiles, ...trackedChangedFiles])).sort(
          (a, b) => a.localeCompare(b),
        );
        if (files.length === 0) return [];
        const valid: string[] = [];
        for (const rel of files) {
          const st = await fsp.lstat(rel).catch(() => null);
          if (!st || st.isDirectory()) continue;
          valid.push(rel);
        }
        return valid;
      })();
    }
    return await overlayFilesOncePerWorker;
  };
  const cached = await listOverlayFilesOncePerWorker();
  if (cached.length === 0) return;
  const valid: string[] = [];
  for (const rel of cached) {
    const st = await fsp.lstat(rel).catch(() => null);
    if (!st || st.isDirectory()) continue;
    valid.push(rel);
  }
  if (valid.length !== cached.length) {
    overlayFilesOncePerWorker = Promise.resolve(valid);
  }
  if (valid.length === 0) return;
  const fileList = await fsp.mkdtemp(path.join(tmpDir, ".seed-overlay-"));
  const listPath = path.join(fileList, "files.txt");
  await fsp.writeFile(listPath, valid.join("\n") + "\n", "utf8");
  try {
    await $({ cwd: process.cwd() })`rsync -a --relative --files-from ${listPath} ./ ${tmpDir}/`;
  } finally {
    await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
  }
}

async function seedStoreCowCopySupportedOncePerWorker(args: {
  timeAsync: TimeAsync;
  seedPath: string;
  tmpDir: string;
}): Promise<true> {
  if (seedStoreCowCopySupported) return seedStoreCowCopySupported;
  if (!seedStoreCowCopySupportedPromise) {
    seedStoreCowCopySupportedPromise = (async () => {
      const srcFile = path.join(args.seedPath, "flake.nix");
      const supported = await args.timeAsync(CLONE_PROBE_LABEL, async () => {
        return await probeSeedCowCopyFrom({
          srcFile,
          dstDir: args.tmpDir,
        });
      });
      if (!supported) {
        throw new Error(
          `runInTemp: seed store CoW clone unsupported for ${args.seedPath}; rerun v on a CoW-capable filesystem`,
        );
      }
      seedStoreCowCopySupported = true;
      return seedStoreCowCopySupported;
    })();
  }
  return await seedStoreCowCopySupportedPromise;
}

export async function initTempRepoFromSeedStore(args: {
  tmpDir: string;
  deps: SeedDeps;
}): Promise<RepoInitMode> {
  const { tmpDir, deps } = args;
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  const seedKey = String(process.env.VBR_TEST_SEED_KEY || "").trim();
  if (wantsFilteredRsync()) {
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }
  if (!seedPath) {
    if (isVerifyMode()) {
      throw new Error("runInTemp: missing VBR_TEST_SEED_STORE_PATH; rerun v");
    }
    await deps.rsyncRepoTo(tmpDir);
    return "rsync";
  }
  await requireSeedPath(seedPath, seedKey);
  await assertRequiredSeedFiles(seedPath, "seed store");
  await seedStoreCowCopySupportedOncePerWorker({
    timeAsync: deps.timeAsync,
    seedPath,
    tmpDir,
  });
  await deps.timeAsync(`seedStoreCopy(${path.basename(tmpDir)})`, async () => {
    await copySeedStoreToTempRepo({ seedPath, tmpDir });
  });
  await deps.timeAsync(`seedOverlayUntracked(${path.basename(tmpDir)})`, async () => {
    await overlayUntrackedFilesIntoTempRepo(tmpDir);
  });
  if (!(await isSeedStoreWritable(seedPath))) {
    try {
      await $`bash --noprofile --norc -c ${`chmod -R u+w ${tmpDir} >/dev/null 2>&1 || true`}`;
    } catch {}
  }
  await assertRequiredSeedFiles(tmpDir, "seed copy");
  return "seed-store";
}
