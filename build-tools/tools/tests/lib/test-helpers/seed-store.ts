import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  GENERATED_REPO_STATE_PATHS,
  isGeneratedRepoStateRelPath,
} from "../../../dev/verify/generated-state-excludes";
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

export type RepoInitMode = "rsync" | "seed-store";

export type RepoInitResult = {
  mode: RepoInitMode;
  touchedRelPaths: string[];
};

const CLONE_PROBE_LABEL = "seedStore clone probe (copyFileCloneSupport)";
const PREPARED_MARKER = ".seed-store-prepared-v3";

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

function shouldOverlaySeedFile(rel: string): boolean {
  if (isGeneratedRepoStateRelPath(rel)) return false;
  return (
    rel === "flake.nix" ||
    rel === "flake.lock" ||
    rel.startsWith(".viberoots/") ||
    rel.startsWith("build-tools/") ||
    rel.startsWith("viberoots/")
  );
}

async function requireSeedPath(seedPath: string, seedKey: string): Promise<void> {
  const st = await fsp.stat(seedPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    const hint = seedKey ? `seed key: ${seedKey}` : "seed key: <missing>";
    throw new Error(`runInTemp: seed store path missing: ${seedPath}\n${hint}\nrerun v`);
  }
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
        .filter(shouldOverlaySeedFile)
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
        .filter(shouldOverlaySeedFile)
        .sort((a, b) => a.localeCompare(b));
      return Array.from(new Set(rels));
    })();
  }
  return await trackedOverlayOncePerWorker;
}

async function overlayUntrackedFilesIntoTempRepo(tmpDir: string): Promise<string[]> {
  const prepared = await fsp
    .access(path.join(tmpDir, PREPARED_MARKER))
    .then(() => true)
    .catch(() => false);
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
  if (cached.length === 0) return [];
  const valid: string[] = [];
  for (const rel of cached) {
    if (prepared && rel.startsWith("viberoots/")) continue;
    const st = await fsp.lstat(rel).catch(() => null);
    if (!st || st.isDirectory()) continue;
    valid.push(rel);
  }
  if (valid.length !== cached.length) {
    overlayFilesOncePerWorker = Promise.resolve(valid);
  }
  if (valid.length === 0) return [];
  const fileList = await fsp.mkdtemp(path.join(tmpDir, ".seed-overlay-"));
  const listPath = path.join(fileList, "files.txt");
  await fsp.writeFile(listPath, valid.join("\n") + "\n", "utf8");
  try {
    await $({ cwd: process.cwd() })`rsync -a --relative --files-from ${listPath} ./ ${tmpDir}/`;
  } finally {
    await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
  }
  return valid;
}

function parseGitStatusRel(line: string): { rel: string; deleted: boolean } | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const raw = line.slice(3).trim();
  if (!raw) return null;
  const renameSep = raw.indexOf(" -> ");
  const rel = (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
  if (!rel || rel.startsWith(".git/") || rel === ".git") return null;
  return {
    rel,
    deleted: status.includes("D"),
  };
}

async function listActiveSourceOverlayFiles(source: string): Promise<{
  changed: string[];
  deleted: string[];
}> {
  const out = await $({
    stdio: "pipe",
    cwd: source,
  })`git status --porcelain=v1 --untracked-files=all`.nothrow();
  if (out.exitCode !== 0) return { changed: [], deleted: [] };
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of String(out.stdout || "").split(/\r?\n/)) {
    const entry = parseGitStatusRel(line);
    if (!entry) continue;
    if (isGeneratedRepoStateRelPath(entry.rel)) continue;
    if (entry.deleted) {
      deleted.push(entry.rel);
      continue;
    }
    const abs = path.join(source, entry.rel);
    const st = await fsp.lstat(abs).catch(() => null);
    if (!st || st.isDirectory()) continue;
    changed.push(entry.rel);
  }
  return {
    changed: Array.from(new Set(changed)).sort((a, b) => a.localeCompare(b)),
    deleted: Array.from(new Set(deleted)).sort((a, b) => a.localeCompare(b)),
  };
}

async function overlayActiveViberootsIntoTempRepo(tmpDir: string): Promise<string[]> {
  const prepared = await fsp
    .access(path.join(tmpDir, PREPARED_MARKER))
    .then(() => true)
    .catch(() => false);
  if (prepared) return [];

  const cwd = process.cwd();
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(cwd, "viberoots"),
    cwd,
  ].filter(Boolean);
  let source = "";
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const sourceFlake = path.join(root, "flake.nix");
    const sourceTool = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
    const sourceExists = await Promise.all([
      fsp
        .access(sourceFlake)
        .then(() => true)
        .catch(() => false),
      fsp
        .access(sourceTool)
        .then(() => true)
        .catch(() => false),
    ]).then(([hasFlake, hasTool]) => hasFlake && hasTool);
    if (sourceExists) {
      source = root;
      break;
    }
  }
  if (!source) return [];
  const tmpViberoots = path.join(tmpDir, "viberoots");
  const overlay = await listActiveSourceOverlayFiles(source);
  const touchedRelPaths = [...overlay.changed, ...overlay.deleted].map((rel) =>
    path.join("viberoots", rel),
  );
  for (const rel of overlay.deleted) {
    await fsp.rm(path.join(tmpViberoots, rel), { recursive: true, force: true });
  }
  if (overlay.changed.length === 0) return touchedRelPaths;
  const fileList = await fsp.mkdtemp(path.join(tmpDir, ".seed-viberoots-overlay-"));
  const listPath = path.join(fileList, "files.txt");
  await fsp.writeFile(listPath, overlay.changed.join("\n") + "\n", "utf8");
  try {
    await $({ cwd: source })`rsync -a --relative --files-from ${listPath} ./ ${tmpViberoots}/`;
  } finally {
    await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
  }
  return touchedRelPaths;
}

async function seedStoreCowCopySupportedOncePerWorker(args: {
  timeAsync: TimeAsync;
  seedPath: string;
  tmpDir: string;
}): Promise<true> {
  if (seedStoreCowCopySupported) return seedStoreCowCopySupported;
  if (!seedStoreCowCopySupportedPromise) {
    seedStoreCowCopySupportedPromise = (async () => {
      const hiddenFlake = path.join(args.seedPath, ".viberoots", "workspace", "flake.nix");
      const rootFlake = path.join(args.seedPath, "flake.nix");
      const srcFile = (await fsp
        .access(hiddenFlake)
        .then(() => true)
        .catch(() => false))
        ? hiddenFlake
        : rootFlake;
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
}): Promise<RepoInitResult> {
  const { tmpDir, deps } = args;
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  const seedKey = String(process.env.VBR_TEST_SEED_KEY || "").trim();
  if (wantsFilteredRsync()) {
    await deps.rsyncRepoTo(tmpDir);
    return { mode: "rsync", touchedRelPaths: [] };
  }
  if (!seedPath) {
    if (isVerifyMode()) {
      throw new Error("runInTemp: missing VBR_TEST_SEED_STORE_PATH; rerun v");
    }
    await deps.rsyncRepoTo(tmpDir);
    return { mode: "rsync", touchedRelPaths: [] };
  }
  await requireSeedPath(seedPath, seedKey);
  await assertRequiredSeedFiles(seedPath, "seed store", { allowMissingToolRoot: true });
  await seedStoreCowCopySupportedOncePerWorker({
    timeAsync: deps.timeAsync,
    seedPath,
    tmpDir,
  });
  const touchedRelPaths: string[] = [];
  await deps.timeAsync(`seedStoreCopy(${path.basename(tmpDir)})`, async () => {
    await copySeedStoreToTempRepo({ seedPath, tmpDir });
  });
  await deps.timeAsync(`seedOverlayUntracked(${path.basename(tmpDir)})`, async () => {
    touchedRelPaths.push(...(await overlayUntrackedFilesIntoTempRepo(tmpDir)));
  });
  await deps.timeAsync(`seedOverlayViberoots(${path.basename(tmpDir)})`, async () => {
    touchedRelPaths.push(...(await overlayActiveViberootsIntoTempRepo(tmpDir)));
  });
  await assertRequiredSeedFiles(tmpDir, "seed copy");
  return {
    mode: "seed-store",
    touchedRelPaths: Array.from(new Set(touchedRelPaths)).sort((a, b) => a.localeCompare(b)),
  };
}
