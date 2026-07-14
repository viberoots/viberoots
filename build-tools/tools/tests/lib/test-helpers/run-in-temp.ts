import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBuckConfigForTempRepo, ensureWorkspaceRootEnvFile } from "./buck-config";
import { rethrowAfterAsyncCleanup, runAsyncCleanupSteps, withAsyncCleanup } from "./async-cleanup";
import {
  buckCleanupRootsForRepo,
  killBuckDaemonsForRepo,
  killBuckDaemonsForRoots,
} from "./buck-kill";
import { ensureBuckReaperStarted } from "./buck-reaper";
import { getCgoToolchainPathsOncePerWorker, getDarwinSdkPathOncePerWorker } from "./cgo-toolchain";
import { rewriteCoverageUrls } from "./coverage";
import { cleanupTempRepoProcesses } from "../../../dev/verify/temp-repo-process-cleanup";
import { registerBuckIsolationSync } from "../../../dev/verify/owned-process-state";
import { rsyncRepoTo } from "./rsync";
import { initTempRepoFromSeedStore } from "./seed-store";
import { timeAsync } from "./timing";
import { ensureToolchainPathsForTempRepo } from "./toolchain-paths";
import { mktemp } from "./tmp";
import { removeTreeWithWritableFallback } from "./remove-tree";
import { ensureSharedNixTarballCacheRepo } from "./xdg-cache";
import "./worker-init";
import { ensureZxInitProbedOnce } from "./zx-init-probe";
import {
  pinnedCacertBundleExpr,
  nixEvalTempDirOutsideWorkspace,
  pinnedNixpkgsPackageExpr,
  pinnedNixpkgsOutPathExpr,
} from "../../../lib/pinned-nixpkgs";
import { withGitAutoMaintenanceDisabledEnv } from "../../../lib/git-auto-maintenance-env";
import { withSanitizedInheritedNixConfig } from "../../../lib/nix-config-env";
import { externalPnpmStateDirs } from "../../../lib/pnpm-state-paths";
import { stableBuckIsolation } from "../../../lib/buck-command-env";
import { resolveToolPathSync } from "../../../lib/tool-paths";
import { pathExists } from "../../../lib/repo";
import { repoNodeBinDirectories } from "../../../lib/repo-node-bin";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../../lib/macos-metadata";
import { ensureWorkspaceProvidersPackage } from "../../../lib/workspace-providers-package";
import { resolveFinalPnpmStore } from "../../../dev/update-pnpm-hash/realized-store";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../../dev/nix-build-filtered-flake-lib";
import {
  materializeFilteredViberootsSource,
  type MaterializedPathInput,
} from "../../../dev/filtered-flake-viberoots-input";

const LOCAL_FIXTURE_SERVICE_ENV = "VBR_DEPLOY_LOCAL_FIXTURE_SERVICE";
const PREPARED_SEED_MARKER = ".seed-store-prepared-v7";

let cachedPinnedNixpkgsPath: Promise<string> | null = null;
let cachedPinnedCacertPath: Promise<string> | null = null;
let cachedUnifiedPnpmStorePath: Promise<string> | null = null;
let envMutationQueue: Promise<void> = Promise.resolve();
const preNoindexStableRootCleanup = new Set<string>();
const TEST_HOME_ACTIVE_PID_FILE = ".viberoots-test-home-pid";
const TEST_HOME_UNMARKED_STALE_MS = 60 * 60 * 1000;
const TEST_HOME_UNMARKED_MAX_COUNT = 256;
let stableTestHomeRootCleanupOnce: Promise<void> | null = null;
const stableTestHomeExitCleanup = new Set<string>();

async function removeDarwinPreNoindexStableRoot(root: string): Promise<void> {
  if (process.platform !== "darwin" || !root.endsWith(".noindex")) return;
  const preNoindexRoot = root.slice(0, -".noindex".length);
  if (preNoindexStableRootCleanup.has(preNoindexRoot)) return;
  preNoindexStableRootCleanup.add(preNoindexRoot);
  await fsp.rm(preNoindexRoot, { recursive: true, force: true }).catch(() => {});
}

function transientNixStoreError(output: unknown): boolean {
  const text = String(output || "");
  return /path '\/nix\/store\/[^']+' is not valid/.test(text) || /database is locked/.test(text);
}

async function withTempProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prevGate = envMutationQueue;
  let releaseGate: (() => void) | null = null;
  envMutationQueue = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  await prevGate;
  const keys = Array.from(new Set(Object.keys(overrides)));
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) prev[key] = process.env[key];
  for (const key of keys) {
    const next = overrides[key];
    if (typeof next === "string") process.env[key] = next;
    else delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const val = prev[key];
      if (typeof val === "string") process.env[key] = val;
      else delete process.env[key];
    }
    releaseGate?.();
  }
}

type TempViberootsRoles = {
  commandSourceRoot: string;
  consumerSnapshotRoot: string;
  flakeInput: MaterializedPathInput;
};

async function exportDevEnvWithRetry($: any, roles: TempViberootsRoles): Promise<string> {
  const consumerFlakeRoot = await workspaceFlakeRef(roles.consumerSnapshotRoot);
  const filteredSnapshotEnv = {
    ...process.env,
    WORKSPACE_ROOT: roles.consumerSnapshotRoot,
    BUCK_TEST_SRC: roles.consumerSnapshotRoot,
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: roles.consumerSnapshotRoot,
  };
  const hasRootImporter = await pathExists(path.join(roles.consumerSnapshotRoot, "pnpm-lock.yaml"));
  const fixedStore = hasRootImporter
    ? await resolveFinalPnpmStore({
        repoRoot: roles.commandSourceRoot,
        importer: ".",
        flakeRef: `path:${consumerFlakeRoot}`,
        attrPath: "pnpm-store",
        env: filteredSnapshotEnv,
      })
    : { cleanup: async () => {} };
  const runOnce = async () => {
    // Avoid direnv here: it can be slow and re-run per temp repo, while nix develop is deterministic.
    const nixOut = await $({
      cwd: roles.consumerSnapshotRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: withSanitizedInheritedNixConfig({
        ...filteredSnapshotEnv,
        IN_NIX_SHELL: "1",
        VIBEROOTS_ROOT: roles.commandSourceRoot,
        VIBEROOTS_SOURCE_ROOT: roles.commandSourceRoot,
        VIBEROOTS_FLAKE_INPUT_ROOT: roles.flakeInput.storePath,
      }),
    })`nix develop ${`path:${consumerFlakeRoot}`} --no-write-lock-file --accept-flake-config -c env -0`;
    return nixOut;
  };
  try {
    let out = await runOnce();
    if (
      Number(out.exitCode || 0) !== 0 &&
      transientNixStoreError(`${out.stdout || ""}\n${out.stderr || ""}`)
    ) {
      console.error("[runInTemp] transient nix store error while exporting dev env; retrying once");
      await new Promise((resolve) => setTimeout(resolve, 750));
      out = await runOnce();
    }
    if (Number(out.exitCode || 0) !== 0) {
      throw new Error(
        String(out.stderr || out.stdout || "nix develop failed while exporting dev env"),
      );
    }
    return String((out as any).stdout || "");
  } finally {
    await fixedStore.cleanup();
  }
}

async function retryTransientNixStoreFailure<T>(
  label: string,
  runOnce: () => Promise<T>,
  outputFor: (result: T) => unknown,
  failed: (result: T) => boolean,
): Promise<T> {
  let out = await runOnce();
  if (failed(out) && transientNixStoreError(outputFor(out))) {
    console.error(`[runInTemp] transient nix store error while ${label}; retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    out = await runOnce();
  }
  return out;
}

async function pinnedNixpkgsPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedNixpkgsPath) return await cachedPinnedNixpkgsPath;
  cachedPinnedNixpkgsPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await mkdirWithMacosMetadataExclusion(nixEvalTmp).catch(() => {});
    const lockPath = await workspaceFlakeLockPath(repoRoot);
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
        TMPDIR: nixEvalTmp,
      },
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedNixpkgsOutPathExpr(lockPath)}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedNixpkgsPath;
}

async function pinnedCacertPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedCacertPath) return await cachedPinnedCacertPath;
  cachedPinnedCacertPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await mkdirWithMacosMetadataExclusion(nixEvalTmp).catch(() => {});
    const lockPath = await workspaceFlakeLockPath(repoRoot);
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
        TMPDIR: nixEvalTmp,
      },
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedCacertBundleExpr(lockPath)}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedCacertPath;
}

async function workspaceFlakePath(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  if (await pathExists(hidden)) return hidden;
  return path.join(root, "flake.nix");
}

export async function workspaceFlakeRef(root: string): Promise<string> {
  const flakePath = await workspaceFlakePath(root);
  return path.basename(flakePath) === "flake.nix" ? path.dirname(flakePath) : flakePath;
}

async function workspaceFlakeLockPath(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.lock");
  if (await pathExists(hidden)) return hidden;
  return path.join(root, "flake.lock");
}

async function candidateTempFlakePaths(root: string): Promise<string[]> {
  const candidates = [
    path.join(root, "flake.nix"),
    path.join(root, ".viberoots", "workspace", "flake.nix"),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate);
  }
  return existing;
}

async function candidateTempFlakeLockPaths(root: string): Promise<string[]> {
  const candidates = [
    path.join(root, "flake.lock"),
    path.join(root, ".viberoots", "workspace", "flake.lock"),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate);
  }
  return existing;
}

async function stableTestHomeRoot(): Promise<string> {
  // Keep per-test HOME outside repo-local TMPDIR to avoid flake input churn and rsync/nix races
  // caused by transient tool caches (e.g. pnpm metadata temp files).
  if (process.platform === "win32") return os.tmpdir();
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-test-home${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  await cleanupStableTestHomesOnce(root);
  return root;
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function activeTestHomePid(home: string): Promise<number | null> {
  try {
    const text = await fsp.readFile(path.join(home, TEST_HOME_ACTIVE_PID_FILE), "utf8");
    const pid = Number.parseInt(text.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function markActiveTestHome(home: string): Promise<void> {
  await fsp.writeFile(path.join(home, TEST_HOME_ACTIVE_PID_FILE), `${process.pid}\n`, "utf8");
}

function registerStableTestHomeExitCleanup(home: string): void {
  if (stableTestHomeExitCleanup.has(home)) return;
  stableTestHomeExitCleanup.add(home);
  process.once("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {}
  });
}

async function cleanupStableTestHomesOnce(root: string): Promise<void> {
  if (stableTestHomeRootCleanupOnce) return await stableTestHomeRootCleanupOnce;
  stableTestHomeRootCleanupOnce = cleanupStableTestHomes(root).catch((err) => {
    console.warn(`warning: failed to clean stale test HOME dirs under ${root}:`, err);
  });
  return await stableTestHomeRootCleanupOnce;
}

async function cleanupStableTestHomes(root: string): Promise<void> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const homes = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("home-"))
    .map((entry) => path.join(root, entry.name));
  const now = Date.now();
  const unmarked: Array<{ path: string; mtimeMs: number }> = [];

  for (const home of homes) {
    const pid = await activeTestHomePid(home);
    if (pid !== null) {
      if (!pidIsAlive(pid)) await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    const stat = await fsp.stat(home).catch(() => null);
    if (!stat?.isDirectory()) continue;
    if (now - stat.mtimeMs >= TEST_HOME_UNMARKED_STALE_MS) {
      await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
    } else {
      unmarked.push({ path: home, mtimeMs: stat.mtimeMs });
    }
  }

  if (unmarked.length <= TEST_HOME_UNMARKED_MAX_COUNT) return;
  unmarked.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const removeCount = unmarked.length - TEST_HOME_UNMARKED_MAX_COUNT;
  for (const stale of unmarked.slice(0, removeCount)) {
    await fsp.rm(stale.path, { recursive: true, force: true }).catch(() => {});
  }
}

async function stableGoModCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-go-modcache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-go-modcache${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  return root;
}

async function stableXdgCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-xdg-cache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const noindex = process.platform === "darwin" ? ".noindex" : "";
  const root = path.join(base, `viberoots-xdg-cache${suffix}${noindex}`);
  await removeDarwinPreNoindexStableRoot(root);
  await mkdirWithMacosMetadataExclusion(root).catch(() => {});
  return root;
}

async function activeViberootsRootFromWorkspace(): Promise<string> {
  const repoRoot = process.cwd();
  const moduleRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../..",
  );
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    moduleRoot,
    repoRoot,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (isGeneratedFilteredViberootsInputPath(root)) continue;
    const consumerViberoots = path.join(root, "viberoots");
    if (
      (await pathExists(path.join(consumerViberoots, "flake.nix"))) &&
      (await pathExists(path.join(consumerViberoots, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return consumerViberoots;
    }
    if (
      (await pathExists(path.join(root, "flake.nix"))) &&
      (await pathExists(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return root;
    }
  }
  return repoRoot;
}

async function prepareFilteredViberootsInput(sourceRoot: string): Promise<MaterializedPathInput> {
  const workDirRaw = await mkdtempNoindex("vbr-run-in-temp-input-", {
    baseName: "vbr-run-in-temp-input",
    tmpBase: process.env.TMPDIR || "/tmp",
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const inputRoot = path.join(workDir, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (rel === ".viberoots" || rel.startsWith(".viberoots/")) continue;
      if (await pathExists(path.join(sourceRoot, rel))) relPaths.push(rel);
    }
    const sources = defaultFilteredFlakeSnapshotRsyncSources(relPaths);
    if (!sources.includes("./flake.nix")) {
      throw new Error(`runInTemp: active viberoots source is missing flake.nix: ${sourceRoot}`);
    }
    await mkdirWithMacosMetadataExclusion(inputRoot);
    await $({
      cwd: sourceRoot,
    })`rsync -a --delete --relative ${filteredFlakeRsyncExcludeArgs()} ${sources} ${inputRoot}/`;
    for (const excluded of [".viberoots", "buck-out", "node_modules"]) {
      if (await pathExists(path.join(inputRoot, excluded))) {
        throw new Error(`runInTemp: filtered viberoots input retained ${excluded}`);
      }
    }
    return await materializeFilteredViberootsSource(inputRoot);
  } finally {
    await removeTreeWithWritableFallback(workDir, $);
  }
}

async function prepareFilteredConsumerSnapshot(
  consumerRoot: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const workDirRaw = await mkdtempNoindex("vbr-run-in-temp-consumer-", {
    baseName: "vbr-run-in-temp-consumer",
    tmpBase: process.env.TMPDIR || "/tmp",
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const snapshotRoot = path.join(workDir, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (await pathExists(path.join(consumerRoot, rel))) relPaths.push(rel);
    }
    const sources = defaultFilteredFlakeSnapshotRsyncSources(relPaths);
    if (!sources.includes("./flake.nix")) {
      throw new Error(`runInTemp: consumer workspace is missing flake.nix: ${consumerRoot}`);
    }
    await mkdirWithMacosMetadataExclusion(snapshotRoot);
    await $({
      cwd: consumerRoot,
    })`rsync -a --delete --relative ${filteredFlakeRsyncExcludeArgs()} ${sources} ${snapshotRoot}/`;
    for (const excluded of [
      ".viberoots/current",
      ".viberoots/workspace/prelude",
      "viberoots/prelude",
    ]) {
      if (await pathExists(path.join(snapshotRoot, excluded))) {
        throw new Error(`runInTemp: filtered consumer snapshot retained ${excluded}`);
      }
    }
    return {
      root: snapshotRoot,
      cleanup: async () => await removeTreeWithWritableFallback(workDir, $),
    };
  } catch (error) {
    await rethrowAfterAsyncCleanup(error, async () => removeTreeWithWritableFallback(workDir, $));
  }
}

function isGeneratedFilteredViberootsInputPath(value: string): boolean {
  const normalized = String(value || "")
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "");
  return (
    normalized === "viberoots-flake-input" ||
    normalized.startsWith("viberoots-flake-input/") ||
    normalized.endsWith("/.viberoots/workspace/viberoots-flake-input") ||
    normalized.includes("/.viberoots/workspace/viberoots-flake-input/")
  );
}

function relFromTempRoot(tmp: string, absPath: string): string {
  return path.relative(tmp, absPath).split(path.sep).join("/");
}

function uniqueRelPaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((p) => p.split(path.sep).join("/"))
        .map((p) => p.replace(/^\/+/, ""))
        .filter((p) => p && p !== "." && !p.startsWith("../") && !path.isAbsolute(p)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

async function gitStageRelPaths($tmp: typeof $, tmp: string, relPaths: string[]): Promise<void> {
  const paths = uniqueRelPaths(relPaths);
  if (paths.length === 0) return;

  const existing: string[] = [];
  const forceExisting: string[] = [];
  const missing: string[] = [];
  for (const relPath of paths) {
    if (await pathExists(path.join(tmp, relPath))) {
      if (
        relPath === ".viberoots/workspace/flake.nix" ||
        relPath === ".viberoots/workspace/flake.lock"
      ) {
        forceExisting.push(relPath);
      } else if (!relPath.startsWith(".viberoots/")) {
        existing.push(relPath);
      }
    } else {
      missing.push(relPath);
    }
  }

  if (existing.length > 0) {
    await $tmp`git add -- ${existing}`;
  }
  if (forceExisting.length > 0) {
    await $tmp`git add -f -- ${forceExisting}`;
  }
  if (missing.length > 0) {
    await $tmp`git rm -q --ignore-unmatch -- ${missing}`;
  }
}

async function rewriteTempViberootsInput(
  tmp: string,
  input: MaterializedPathInput,
): Promise<string[]> {
  const activeViberootsRoot = input.storePath;
  const touched: string[] = [];
  for (const flakePath of await candidateTempFlakePaths(tmp)) {
    const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
    if (!text) continue;
    let next = text.replace(
      /(\bviberoots\.url\s*=\s*)"[^"]*"/,
      (_match, prefix: string) => `${prefix}"path:${activeViberootsRoot}"`,
    );
    next = next.replace(/^\s*viberoots\.ref\s*=\s*"[^"]*";\n/gm, "");
    next = next.replace(
      /(inputs\.viberoots\s*=\s*\{\s*url\s*=\s*"path:[^"]*";\n)\s*ref\s*=\s*"[^"]*";\n/g,
      "$1",
    );
    if (!next.includes('"VIBEROOTS_FLAKE_INPUT_ROOT"')) {
      next = next.replace(/(\s*"VIBEROOTS_SOURCE_ROOT"\n)/, '$1    "VIBEROOTS_FLAKE_INPUT_ROOT"\n');
    }
    if (next !== text) {
      await fsp.writeFile(flakePath, next, "utf8");
      touched.push(relFromTempRoot(tmp, flakePath));
    }
  }
  touched.push(...(await rewriteTempViberootsLockInput(tmp, input)));
  return uniqueRelPaths(touched);
}

function rewriteViberootsLockEntry(
  entry: unknown,
  activeViberootsRoot: string,
  metadata?: Record<string, unknown>,
): boolean {
  if (!entry || typeof entry !== "object") return false;
  const node = entry as { type?: unknown; path?: unknown; url?: unknown };
  const rawPath =
    node.type === "path"
      ? String(node.path || "")
      : node.type === "git"
        ? String(node.url || "").replace(/^file:/, "")
        : "";
  const isRecognized =
    rawPath === "" ||
    path.basename(rawPath) === "viberoots" ||
    isGeneratedFilteredViberootsInputPath(rawPath) ||
    String(node.url || "").includes("viberoots/viberoots");
  if (!isRecognized) return false;
  const mutableNode = node as {
    lastModified?: number;
    lastModifiedDate?: string;
    narHash?: string;
    path: unknown;
    ref?: string;
    rev?: string;
    revCount?: number;
    type: unknown;
    url?: string;
  };
  mutableNode.type = "path";
  mutableNode.path = activeViberootsRoot;
  if (typeof metadata?.lastModified === "number") {
    mutableNode.lastModified = metadata.lastModified;
  }
  if (typeof metadata?.narHash === "string") mutableNode.narHash = metadata.narHash;
  delete mutableNode.lastModifiedDate;
  delete mutableNode.ref;
  delete mutableNode.rev;
  delete mutableNode.revCount;
  delete mutableNode.url;
  return true;
}

async function rewriteTempViberootsLockInput(
  tmp: string,
  input: MaterializedPathInput,
): Promise<string[]> {
  const activeViberootsRoot = input.storePath;
  const touched: string[] = [];
  for (const lockPath of await candidateTempFlakeLockPaths(tmp)) {
    const text = await fsp.readFile(lockPath, "utf8").catch(() => "");
    if (!text) continue;
    let lock: any;
    try {
      lock = JSON.parse(text);
    } catch {
      continue;
    }
    const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
    const node = lock?.nodes?.[inputName] || lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
    if (!node || typeof node !== "object") continue;
    const lockedChanged = rewriteViberootsLockEntry(node.locked, activeViberootsRoot, input.locked);
    const originalChanged = rewriteViberootsLockEntry(node.original, activeViberootsRoot);
    const changed = lockedChanged || originalChanged;
    if (!changed) continue;
    await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
    touched.push(relFromTempRoot(tmp, lockPath));
  }
  return touched;
}

async function tempViberootsRootIfPresent(tmp: string): Promise<string | null> {
  const candidate = path.join(tmp, "viberoots");
  if (
    (await pathExists(path.join(candidate, "flake.nix"))) &&
    (await pathExists(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs")))
  ) {
    return candidate;
  }
  return null;
}

async function seedStoreViberootsRootIfPresent(): Promise<string | null> {
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  if (!seedPath) return null;
  const candidate = path.join(seedPath, "viberoots");
  if (
    (await pathExists(path.join(seedPath, PREPARED_SEED_MARKER))) &&
    (await pathExists(path.join(candidate, "flake.nix"))) &&
    (await pathExists(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs")))
  ) {
    return await fsp.realpath(candidate).catch(() => candidate);
  }
  return null;
}

async function removeInheritedBuildToolsSymlink(tmp: string): Promise<string[]> {
  const buildTools = path.join(tmp, "build-tools");
  const st = await fsp.lstat(buildTools).catch(() => null);
  if (st?.isSymbolicLink()) {
    await fsp.rm(buildTools, { force: true });
    return ["build-tools"];
  }
  return [];
}

async function removeCppReqsIfRequested(tmp: string): Promise<string[]> {
  if (String(process.env.TEST_EXCLUDE_CPP_REQS || "").trim() !== "1") return [];
  const rels = [
    "viberoots/build-tools/cpp/defs.bzl",
    "viberoots/build-tools/cpp/wasm_defs.bzl",
    "viberoots/build-tools/tools/nix/templates/cpp.nix",
  ];
  const touched: string[] = [];
  for (const rel of rels) {
    try {
      await fsp.rm(path.join(tmp, rel), { force: true });
      touched.push(rel);
    } catch {}
  }
  return touched;
}

async function trackedNpmrcDirs(tmp: string): Promise<string[]> {
  const out = await $({ cwd: tmp, stdio: "pipe" })`git ls-files -- "**/.npmrc"`.nothrow().quiet();
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rel) => path.join(tmp, path.dirname(rel)));
}

async function ensurePnpmfilePlaceholders(tmp: string): Promise<string[]> {
  if (await pathExists(path.join(tmp, PREPARED_SEED_MARKER))) return [];
  const dirs = new Set<string>([
    tmp,
    path.join(tmp, "viberoots"),
    ...(await trackedNpmrcDirs(tmp)),
  ]);
  const placeholder = "export default {};\n";
  const touched: string[] = [];
  for (const dir of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, ".pnpmfile.mjs");
      await fsp.writeFile(file, placeholder, { flag: "wx" });
      touched.push(relFromTempRoot(tmp, file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
    }
  }
  return uniqueRelPaths(touched);
}

async function unifiedPnpmStoreFromRepoRoot(repoRoot: string): Promise<string> {
  const pathFile = path.join(
    repoRoot,
    ".viberoots",
    "workspace",
    "buck",
    "unified-pnpm-store",
    "path",
  );
  try {
    const txt = await fsp.readFile(pathFile, "utf8");
    const p = String(txt || "").trim();
    if (!p) return "";
    const st = await fsp.stat(p).catch(() => null);
    if (!st || !st.isDirectory()) return "";
    return p;
  } catch {
    return "";
  }
}

async function ensureUnifiedPnpmStoreOncePerWorker($: any): Promise<string> {
  if (cachedUnifiedPnpmStorePath) return await cachedUnifiedPnpmStorePath;
  cachedUnifiedPnpmStorePath = (async () => {
    const repoRoot = process.cwd();
    const existing = await unifiedPnpmStoreFromRepoRoot(repoRoot);
    return existing;
  })();
  return await cachedUnifiedPnpmStorePath;
}

function nixPathHasNixpkgsEntry(value: string): boolean {
  return String(value || "")
    .split(":")
    .map((entry) => entry.trim())
    .some((entry) => entry.startsWith("nixpkgs="));
}

let stableTestHomeOnce: Promise<string> | null = null;
async function stableTestHomeOncePerWorker(): Promise<string> {
  if (stableTestHomeOnce) return await stableTestHomeOnce;
  stableTestHomeOnce = (async () => {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    await markActiveTestHome(home);
    registerStableTestHomeExitCleanup(home);
    return home;
  })();
  return await stableTestHomeOnce;
}

async function resolveTestHome(): Promise<{ home: string; removeOnExit: boolean }> {
  if (String(process.env.TEST_HOME_PER_TEST || "").trim() === "1") {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    await markActiveTestHome(home);
    return { home, removeOnExit: true };
  }
  const home = await stableTestHomeOncePerWorker();
  return { home, removeOnExit: false };
}

async function createTempBuck2Shim(tmp: string, iso: string): Promise<string> {
  const shimDir = path.join(tmp, ".buck2_shim", "bin");
  await fsp.mkdir(shimDir, { recursive: true });
  const realBuck2 = resolveToolPathSync("buck2");
  const shimPath = path.join(shimDir, "buck2");
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_buck2=${JSON.stringify(realBuck2)}`,
      `iso=${JSON.stringify(iso)}`,
      'for arg in "$@"; do',
      '  if [[ "$arg" == "--isolation-dir" ]]; then',
      '    exec "$real_buck2" "$@"',
      "  fi",
      "done",
      'exec "$real_buck2" --isolation-dir "$iso" "$@"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
  return shimDir;
}

async function createTempNixShim(shimDir: string): Promise<void> {
  const realNix = resolveToolPathSync("nix");
  const shimPath = path.join(shimDir, "nix");
  const repoRoot = process.cwd();
  const viberootsCandidates = [
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    repoRoot,
  ].filter(Boolean);
  let viberootsRoot = repoRoot;
  for (const candidate of viberootsCandidates) {
    const root = path.resolve(candidate);
    const consumerViberoots = path.join(root, "viberoots");
    const toolRoot = (await fsp
      .access(path.join(consumerViberoots, "build-tools", "tools", "dev", "zx-init.mjs"))
      .then(() => true)
      .catch(() => false))
      ? consumerViberoots
      : root;
    const hasTool = await fsp
      .access(path.join(toolRoot, "build-tools", "tools", "dev", "zx-init.mjs"))
      .then(() => true)
      .catch(() => false);
    if (hasTool) {
      viberootsRoot = toolRoot;
      break;
    }
  }
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_nix=${JSON.stringify(realNix)}`,
      `viberoots_root=${JSON.stringify(viberootsRoot)}`,
      "sanitize_nix_config(){",
      '  local kept="" line key',
      '  if [[ -n "${NIX_CONFIG:-}" ]]; then',
      '    while IFS= read -r line || [[ -n "$line" ]]; do',
      '    if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9._-]+)[[:space:]]*= ]]; then',
      '      key="${BASH_REMATCH[1]}"',
      '      if [[ "$key" == "eval-cores" || "$key" == "lazy-trees" ]]; then',
      "        continue",
      "      fi",
      "    fi",
      "    kept+=\"${line}\"$'\\n'",
      '    done <<< "$NIX_CONFIG"',
      "  fi",
      "  kept=\"${kept%$'\\n'}\"",
      '  if ! grep -Eq "^[[:space:]]*warn-dirty[[:space:]]*=" <<< "$kept"; then',
      "    kept+=\"${kept:+$'\\n'}warn-dirty = false\"",
      "  fi",
      '  if [[ -n "$kept" ]]; then export NIX_CONFIG="$kept"; else unset NIX_CONFIG; fi',
      "}",
      "sanitize_nix_config",
      'if [[ "${1:-}" == "store" && "${2:-}" == "gc" ]]; then',
      '  exec "$real_nix" "$@"',
      "fi",
      "wait_for_gc(){",
      '  node --experimental-strip-types --import "$viberoots_root/build-tools/tools/dev/zx-init.mjs" "$viberoots_root/build-tools/tools/lib/nix-gc-lock.ts" wait-for-no-active-gc',
      "}",
      'transient_store_error(){ grep -Eq "path .*/nix/store/.*\\.drv. is not valid|database is locked" "$1" "$2"; }',
      "attempt=0",
      'max_attempts="${NIX_TRANSIENT_RETRY_ATTEMPTS:-5}"',
      "while true; do",
      "  wait_for_gc || true",
      '  out="$(mktemp "${TMPDIR:-/tmp}/vbr-nix-shim-out.XXXXXX")"',
      '  err="$(mktemp "${TMPDIR:-/tmp}/vbr-nix-shim-err.XXXXXX")"',
      "  set +e",
      '  "$real_nix" "$@" >"$out" 2>"$err"',
      "  code=$?",
      "  set -e",
      '  cat "$out"',
      '  cat "$err" >&2',
      '  if [[ "$code" == "0" ]]; then rm -f "$out" "$err"; exit 0; fi',
      '  if (( attempt >= max_attempts )) || ! transient_store_error "$out" "$err"; then rm -f "$out" "$err"; exit "$code"; fi',
      "  attempt=$((attempt + 1))",
      '  echo "[nix-shim] transient nix store error; retrying ${attempt}/${max_attempts}" >&2',
      '  rm -f "$out" "$err"',
      "  sleep 1",
      "done",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
}

async function createTempZxWrapperShim(shimDir: string): Promise<void> {
  const realZxWrapper = resolveToolPathSync("zx-wrapper");
  const shimPath = path.join(shimDir, "zx-wrapper");
  await fsp.writeFile(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `real_zx_wrapper=${JSON.stringify(realZxWrapper)}`,
      'if [[ "${1:-}" == build-tools/* && ! -e "${1:-}" && -n "${VIBEROOTS_ROOT:-}" && -e "$VIBEROOTS_ROOT/${1:-}" ]]; then',
      '  set -- "$VIBEROOTS_ROOT/$1" "${@:2}"',
      "fi",
      'exec "$real_zx_wrapper" "$@"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(shimPath, 0o755);
}

function prependPath(env: Record<string, string>, dir: string): void {
  env.PATH = [dir, env.PATH || process.env.PATH || ""].filter(Boolean).join(path.delimiter);
}

function applyTempNodePath(env: Record<string, string>, paths: Array<string | undefined>): void {
  env.NODE_PATH = [
    env.VIBEROOTS_NODE_PATH,
    process.env.VIBEROOTS_NODE_PATH,
    ...paths,
    env.NODE_PATH || "",
  ]
    .filter(Boolean)
    .join(path.delimiter);
}

async function prependTempRepoBin(env: Record<string, string>, tmp: string): Promise<void> {
  const candidates = [
    path.join(tmp, "viberoots", "build-tools", "tools", "bin"),
    env.VIBEROOTS_ROOT ? path.join(env.VIBEROOTS_ROOT, "build-tools", "tools", "bin") : "",
  ].filter(Boolean);
  for (const binDir of candidates.reverse()) {
    const st = await fsp.stat(binDir).catch(() => null);
    if (st?.isDirectory()) prependPath(env, binDir);
  }
}

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
  opts?: {
    git?: boolean;
    reconcileDependencyInputs?: boolean;
    workspace?: "seeded" | "scratch";
  },
): Promise<T> {
  const realHome = String(process.env.HOME || os.homedir() || "").trim();
  const tmp = await mktemp(name + "-");
  // Optional early signal for tests that need the temp path even if setup is interrupted or slow
  // (e.g. to coordinate out-of-process cleanup/reaping assertions).
  if (String(process.env.TEST_EARLY_TMP_STDOUT || "").trim() === "1") {
    try {
      console.log(`TMP ${tmp}`);
    } catch {}
  }
  const { home, removeOnExit: removeHome } = await timeAsync(
    "runInTemp resolveTestHome",
    async () => await resolveTestHome(),
  );
  if (opts?.workspace === "scratch") {
    const xdgCacheHome = await timeAsync(
      "runInTemp stableXdgCacheRoot",
      async () => await stableXdgCacheRoot(),
    );
    const activeViberootsRoot = await timeAsync(
      "runInTemp activeViberootsRoot",
      async () => await activeViberootsRootFromWorkspace(),
    );
    const viberootsInput = await timeAsync(
      "runInTemp prepareFilteredViberootsInput",
      async () => await prepareFilteredViberootsInput(activeViberootsRoot),
    );
    let exportEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") exportEnv[k] = v;
    }
    exportEnv.WORKSPACE_ROOT = tmp;
    exportEnv.BUCK_TEST_SRC = tmp;
    exportEnv.REPO_ROOT = tmp;
    exportEnv.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = process.cwd();
    exportEnv.VBR_RUN_IN_TEMP_REPO = "1";
    exportEnv.SCAF_ALLOW_LIVE_REPO = "1";
    exportEnv.VIBEROOTS_ROOT = activeViberootsRoot;
    exportEnv.VIBEROOTS_SOURCE_ROOT = activeViberootsRoot;
    exportEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
    exportEnv.TEST_NO_BROWSER = exportEnv.TEST_NO_BROWSER || "1";
    exportEnv[LOCAL_FIXTURE_SERVICE_ENV] = exportEnv[LOCAL_FIXTURE_SERVICE_ENV] || "1";
    exportEnv.HOME = home;
    exportEnv.XDG_CACHE_HOME = exportEnv.XDG_CACHE_HOME || xdgCacheHome;
    if (!exportEnv.BUCK2_REAL_HOME && realHome) {
      exportEnv.BUCK2_REAL_HOME = realHome;
    }
    if (!exportEnv.XDG_CONFIG_HOME) {
      exportEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    }
    exportEnv.ZX_INIT = path.join(
      activeViberootsRoot,
      "build-tools",
      "tools",
      "dev",
      "zx-init.mjs",
    );
    await rewriteTempViberootsInput(tmp, viberootsInput);
    await prependTempRepoBin(exportEnv, tmp);
    applyTempNodePath(exportEnv, [
      path.join(process.cwd(), "node_modules"),
      path.join(activeViberootsRoot, "node_modules"),
    ]);
    withSanitizedInheritedNixConfig(exportEnv);
    const nodeOpts = [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      `--import ${exportEnv.ZX_INIT}`,
    ];
    exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
      .filter(Boolean)
      .join(" ");
    exportEnv = withGitAutoMaintenanceDisabledEnv(exportEnv);
    const _$ = $({ cwd: tmp, env: exportEnv });
    try {
      return await timeAsync("runInTemp testBody", async () => {
        return await withTempProcessEnv(exportEnv, async () => await fn(tmp, _$));
      });
    } finally {
      if (process.env.TEST_KEEP_TMP === "1") {
        try {
          console.error(`KEEP_TMP ${tmp}`);
          await fsp
            .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
            .catch(() => {});
        } catch {}
      } else {
        await removeTreeWithWritableFallback(tmp, $);
      }
      if (removeHome) {
        await removeTreeWithWritableFallback(home, $);
      }
    }
  }
  const xdgCacheHome = await timeAsync(
    "runInTemp stableXdgCacheRoot",
    async () => await stableXdgCacheRoot(),
  );
  const activeXdgCacheHome = process.env.XDG_CACHE_HOME || xdgCacheHome;
  await timeAsync("runInTemp ensureSharedNixTarballCacheRepo", async () => {
    await ensureSharedNixTarballCacheRepo(activeXdgCacheHome);
  });
  const tempNestedIso = stableBuckIsolation(tmp, "zxtest-shared");
  registerRunInTempBuckIsolation(tempNestedIso, tmp);
  const buck2ShimDir = await timeAsync(
    "runInTemp createTempBuck2Shim",
    async () => await createTempBuck2Shim(tmp, tempNestedIso),
  );
  await timeAsync("runInTemp createTempNixShim", async () => await createTempNixShim(buck2ShimDir));
  await timeAsync(
    "runInTemp createTempZxWrapperShim",
    async () => await createTempZxWrapperShim(buck2ShimDir),
  );
  const tempSetupEnv = withSanitizedInheritedNixConfig(
    withGitAutoMaintenanceDisabledEnv({
      ...process.env,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      BUCK_ISOLATION_DIR: tempNestedIso,
      BUCK_NESTED_ISO: tempNestedIso,
      TEST_NO_BROWSER: process.env.TEST_NO_BROWSER || "1",
      [LOCAL_FIXTURE_SERVICE_ENV]: process.env[LOCAL_FIXTURE_SERVICE_ENV] || "1",
      BUCK_EXPORTER_REUSE_DAEMON: process.env.BUCK_EXPORTER_REUSE_DAEMON || "1",
      BUCKD_STARTUP_TIMEOUT: process.env.BUCKD_STARTUP_TIMEOUT || "300",
      BUCKD_STARTUP_INIT_TIMEOUT:
        process.env.BUCKD_STARTUP_INIT_TIMEOUT || process.env.BUCKD_STARTUP_TIMEOUT || "300",
      VBR_RUN_IN_TEMP_REPO: "1",
      SCAF_ALLOW_LIVE_REPO: "1",
      REPO_ROOT: process.cwd(),
      VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT: process.cwd(),
      HOME: home,
      XDG_CACHE_HOME: activeXdgCacheHome,
    }),
  );
  prependPath(tempSetupEnv, buck2ShimDir);
  const goModCacheRoot = await timeAsync(
    "runInTemp stableGoModCacheRoot",
    async () => await stableGoModCacheRoot(),
  );
  const initResult = await timeAsync("runInTemp initTempRepoFromSeedStore", async () => {
    return await initTempRepoFromSeedStore({
      tmpDir: tmp,
      deps: { rsyncRepoTo, timeAsync },
    });
  });
  const seedTouchedRelPaths = [...initResult.touchedRelPaths];
  const activeViberootsRoot = await timeAsync(
    "runInTemp activeViberootsRoot",
    async () => await activeViberootsRootFromWorkspace(),
  );
  const tempViberootsRoot = await timeAsync(
    "runInTemp tempViberootsRoot",
    async () => await tempViberootsRootIfPresent(tmp),
  );
  const seedStoreViberootsRoot = await timeAsync(
    "runInTemp seedStoreViberootsRoot",
    async () => await seedStoreViberootsRootIfPresent(),
  );
  const viberootsSourceRoot = tempViberootsRoot || activeViberootsRoot;
  const viberootsInputSourceRoot =
    seedStoreViberootsRoot || tempViberootsRoot || activeViberootsRoot;
  const viberootsInput = await timeAsync(
    "runInTemp prepareFilteredViberootsInput",
    async () => await prepareFilteredViberootsInput(viberootsInputSourceRoot),
  );
  tempSetupEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
  tempSetupEnv.ZX_INIT = path.join(
    viberootsSourceRoot,
    "build-tools",
    "tools",
    "dev",
    "zx-init.mjs",
  );
  await timeAsync("runInTemp rewriteTempViberootsInput", async () => {
    seedTouchedRelPaths.push(...(await rewriteTempViberootsInput(tmp, viberootsInput)));
  });
  await timeAsync("runInTemp removeInheritedBuildToolsSymlink", async () => {
    seedTouchedRelPaths.push(...(await removeInheritedBuildToolsSymlink(tmp)));
  });
  await timeAsync("runInTemp removeCppReqsIfRequested", async () => {
    seedTouchedRelPaths.push(...(await removeCppReqsIfRequested(tmp)));
  });
  await timeAsync("runInTemp ensurePnpmfilePlaceholders", async () => {
    seedTouchedRelPaths.push(...(await ensurePnpmfilePlaceholders(tmp)));
  });

  const wantGit = opts?.git !== false && process.env.TEST_TEMP_GIT !== "0";
  if (wantGit) {
    const $tmp = $({ cwd: tmp, stdio: "pipe", env: tempSetupEnv });
    await timeAsync("runInTemp gitBootstrap", async () => {
      try {
        if (initResult.mode === "rsync") {
          await timeAsync(
            "runInTemp gitBootstrap init",
            async () =>
              await $tmp`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`,
          );
          await timeAsync("runInTemp gitBootstrap addAll", async () => await $tmp`git add -A`);
          await timeAsync(
            "runInTemp gitBootstrap commit",
            async () =>
              await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m init --allow-empty`
                .nothrow()
                .quiet(),
          );
        } else {
          const ok = await timeAsync(
            "runInTemp gitBootstrap revParseInside",
            async () => await $tmp`git rev-parse --is-inside-work-tree`.nothrow().quiet(),
          );
          const inside = String(ok.stdout || "").trim();
          if (inside !== "true") {
            throw new Error(
              `runInTemp: expected seeded temp repo to be a git worktree (mode=${initResult.mode})`,
            );
          }
          const head = await timeAsync(
            "runInTemp gitBootstrap revParseHead",
            async () => await $tmp`git rev-parse HEAD`.nothrow().quiet(),
          );
          if (head.exitCode !== 0) {
            throw new Error(
              `runInTemp: expected seeded temp repo to have an initial commit (mode=${initResult.mode})`,
            );
          }
          const relPaths = uniqueRelPaths(seedTouchedRelPaths);
          if (relPaths.length > 0) {
            await timeAsync(
              "runInTemp gitBootstrap stageOverlay",
              async () => await gitStageRelPaths($tmp, tmp, relPaths),
            );
            const diff = await timeAsync(
              "runInTemp gitBootstrap stagedDiff",
              async () => await $tmp`git diff --cached --quiet --exit-code`.nothrow().quiet(),
            );
            if (diff.exitCode === 1) {
              await timeAsync(
                "runInTemp gitBootstrap commit",
                async () =>
                  await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay --allow-empty`
                    .nothrow()
                    .quiet(),
              );
            } else if (diff.exitCode !== 0) {
              throw new Error(String(diff.stderr || "git diff --cached failed"));
            }
          }
        }
      } catch {
        throw new Error("runInTemp: git is required for deterministic temp-repo nix builds");
      }
    });
  }

  const $setup = $({ cwd: tmp, env: tempSetupEnv, stdio: "pipe" });
  await timeAsync("runInTemp ensureBuckConfigForTempRepo", async () => {
    await ensureBuckConfigForTempRepo(tmp, $setup, {
      viberootsInputRoot: viberootsInput.storePath,
      viberootsSourceRoot,
    });
  });
  await timeAsync("runInTemp ensureWorkspaceProvidersPackage", async () => {
    await ensureWorkspaceProvidersPackage(tmp);
  });
  await timeAsync("runInTemp ensureWorkspaceRootEnvFile", async () => {
    await ensureWorkspaceRootEnvFile(tmp, viberootsSourceRoot, viberootsInput.storePath);
  });
  await timeAsync("runInTemp ensureToolchainPathsForTempRepo", async () => {
    await ensureToolchainPathsForTempRepo(tmp, $setup);
  });
  await timeAsync("runInTemp rewriteTempViberootsInput after setup", async () => {
    const touched = await rewriteTempViberootsInput(tmp, viberootsInput);
    if (!wantGit || touched.length === 0) return;
    const $tmp = $({ cwd: tmp, stdio: "pipe", env: tempSetupEnv });
    await gitStageRelPaths($tmp, tmp, touched);
    const diff = await $tmp`git diff --cached --quiet --exit-code`.nothrow().quiet();
    if (diff.exitCode === 1) {
      await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m seed-overlay-flake --allow-empty`
        .nothrow()
        .quiet();
    } else if (diff.exitCode !== 0) {
      throw new Error(String(diff.stderr || "git diff --cached failed"));
    }
  });

  if (opts?.reconcileDependencyInputs) {
    await timeAsync("runInTemp reconcileTempDependencyInputs", async () => {
      await reconcileTempDependencyInputs(tmp, $setup, viberootsSourceRoot);
    });
  }

  let consumerSnapshot: Awaited<ReturnType<typeof prepareFilteredConsumerSnapshot>> | null = null;
  let envOut: any = { stdout: "" };
  let tempPnpmStateRoot: string | null = null;
  let cleanupCommand: any = null;
  return await withAsyncCleanup(
    async () => {
      if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
        consumerSnapshot = await timeAsync("runInTemp prepareFilteredConsumerSnapshot", async () =>
          prepareFilteredConsumerSnapshot(tmp),
        );
        const snapshot = consumerSnapshot;
        const flakeRef = await workspaceFlakeRef(snapshot.root);
        const snapshotEnv = {
          ...tempSetupEnv,
          WORKSPACE_ROOT: snapshot.root,
          BUCK_TEST_SRC: snapshot.root,
          VBR_FILTERED_FLAKE_SNAPSHOT: "1",
          VBR_PNPM_FILTERED_SNAPSHOT_ROOT: snapshot.root,
        };
        const $snapshot = $({ cwd: snapshot.root, env: snapshotEnv, stdio: "pipe" });
        const chk = await retryTransientNixStoreFailure(
          "checking temp repo buck2-prelude",
          async () =>
            await $snapshot`nix build ${`path:${flakeRef}#buck2-prelude`} --no-link --no-write-lock-file --accept-flake-config --print-build-logs`.nothrow(),
          (out) => `${(out as any).stdout || ""}\n${(out as any).stderr || ""}`,
          (out) => Number((out as any).exitCode || 0) !== 0,
        );
        if (chk.exitCode !== 0) {
          const detail = `${String(chk.stdout || "")}\n${String(chk.stderr || "")}`.trim();
          throw new Error(
            [
              "dev-shell check failed: nix build path:<filtered-temp>#buck2-prelude did not succeed; ensure direnv/dev shell is active",
              detail,
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        envOut = await timeAsync(`devEnvExport(${path.basename(tmp)})`, async () => {
          return {
            stdout: await exportDevEnvWithRetry($, {
              commandSourceRoot: viberootsSourceRoot,
              consumerSnapshotRoot: snapshot.root,
              flakeInput: viberootsInput,
            }),
          };
        });
      }

      let exportEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") exportEnv[k] = v;
      }
      withSanitizedInheritedNixConfig(exportEnv);
      const allowDevOverrides = String(process.env.TEST_ALLOW_DEV_OVERRIDES || "").trim() === "1";
      if (!allowDevOverrides) {
        // Avoid leaking local dev overrides into temp-repo commands unless explicitly allowed.
        for (const key of [
          "NIX_CPP_DEV_OVERRIDE_JSON",
          "NIX_GO_DEV_OVERRIDE_JSON",
          "NIX_PY_DEV_OVERRIDE_JSON",
        ]) {
          delete exportEnv[key];
        }
      }
      exportEnv.REPO_ROOT = process.cwd();
      exportEnv.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = process.cwd();
      exportEnv.CGO_ENABLED = String(exportEnv.CGO_ENABLED || "").trim() || "0";

      const injected = String((envOut as any).stdout || "");
      for (const entry of injected ? injected.split("\0") : []) {
        if (!entry) continue;
        const idx = entry.indexOf("=");
        if (idx > 0) exportEnv[entry.slice(0, idx)] = entry.slice(idx + 1);
      }

      exportEnv.IN_NIX_SHELL = exportEnv.IN_NIX_SHELL || "1";
      try {
        const wsNodeModules = path.join(process.cwd(), "node_modules");
        const activeViberootsNodeModules = path.join(activeViberootsRoot, "node_modules");
        const viberootsSourceNodeModules = path.join(viberootsSourceRoot, "node_modules");
        const viberootsInputNodeModules = path.join(viberootsInput.storePath, "node_modules");
        applyTempNodePath(exportEnv, [
          wsNodeModules,
          activeViberootsNodeModules,
          viberootsSourceNodeModules,
          viberootsInputNodeModules,
        ]);
        const nodeBinDirs = await repoNodeBinDirectories(process.cwd(), exportEnv);
        for (const binDir of nodeBinDirs.reverse()) {
          if ((await fsp.stat(binDir).catch(() => null))?.isDirectory()) {
            prependPath(exportEnv, binDir);
          }
        }
      } catch {}
      exportEnv.WORKSPACE_ROOT = tmp;
      exportEnv.BUCK_TEST_SRC = tmp;
      exportEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
      exportEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
      exportEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
      exportEnv.VBR_RUN_IN_TEMP_REPO = "1";
      exportEnv.SCAF_ALLOW_LIVE_REPO = "1";
      exportEnv.BUCK_ISOLATION_DIR = tempNestedIso;
      exportEnv.BUCK_NESTED_ISO = tempNestedIso;
      exportEnv.TEST_NO_BROWSER = exportEnv.TEST_NO_BROWSER || "1";
      exportEnv[LOCAL_FIXTURE_SERVICE_ENV] = exportEnv[LOCAL_FIXTURE_SERVICE_ENV] || "1";
      exportEnv.BUCK_EXPORTER_REUSE_DAEMON = exportEnv.BUCK_EXPORTER_REUSE_DAEMON || "1";
      exportEnv.BUCKD_STARTUP_TIMEOUT = exportEnv.BUCKD_STARTUP_TIMEOUT || "300";
      exportEnv.BUCKD_STARTUP_INIT_TIMEOUT =
        exportEnv.BUCKD_STARTUP_INIT_TIMEOUT || exportEnv.BUCKD_STARTUP_TIMEOUT;
      exportEnv.HOME = home;
      exportEnv.XDG_CACHE_HOME = exportEnv.XDG_CACHE_HOME || xdgCacheHome;
      if (!exportEnv.BUCK2_REAL_HOME && realHome) {
        exportEnv.BUCK2_REAL_HOME = realHome;
      }
      if (!exportEnv.XDG_CONFIG_HOME) {
        exportEnv.XDG_CONFIG_HOME =
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
      }

      exportEnv.GOPROXY = exportEnv.GOPROXY || "https://proxy.golang.org,direct";
      exportEnv.GOSUMDB = exportEnv.GOSUMDB || "sum.golang.org";
      exportEnv.GOMODCACHE = exportEnv.GOMODCACHE || goModCacheRoot;
      try {
        if (!nixPathHasNixpkgsEntry(exportEnv.NIX_PATH || "")) {
          const pinnedNixpkgs = await timeAsync("runInTemp pinnedNixpkgsPath", async () => {
            return await pinnedNixpkgsPathOncePerWorker($);
          });
          if (pinnedNixpkgs) {
            const nixPathEntries = String(exportEnv.NIX_PATH || "")
              .split(":")
              .map((entry) => entry.trim())
              .filter(Boolean)
              .filter((entry) => !entry.startsWith("nixpkgs="));
            exportEnv.NIX_PATH = [`nixpkgs=${pinnedNixpkgs}`, ...nixPathEntries].join(":");
          }
        }
      } catch {}
      if (!exportEnv.SSL_CERT_FILE && exportEnv.NIX_SSL_CERT_FILE) {
        exportEnv.SSL_CERT_FILE = exportEnv.NIX_SSL_CERT_FILE;
      }
      if (!exportEnv.SSL_CERT_FILE) {
        try {
          const pinnedCacert = await timeAsync("runInTemp pinnedCacertPath", async () => {
            return await pinnedCacertPathOncePerWorker($);
          });
          if (pinnedCacert) {
            exportEnv.SSL_CERT_FILE = pinnedCacert;
            exportEnv.NIX_SSL_CERT_FILE = pinnedCacert;
            exportEnv.NODE_EXTRA_CA_CERTS = exportEnv.NODE_EXTRA_CA_CERTS || pinnedCacert;
          }
        } catch {}
      }
      if (!exportEnv.SSL_CERT_FILE) {
        const defaultCert = "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt";
        try {
          await fsp.access(defaultCert);
          exportEnv.SSL_CERT_FILE = defaultCert;
        } catch {}
      }
      if (!exportEnv.SSL_CERT_DIR && exportEnv.NIX_SSL_CERT_DIR) {
        exportEnv.SSL_CERT_DIR = exportEnv.NIX_SSL_CERT_DIR;
      }
      exportEnv.DIRENV_LOG_FORMAT = "";
      exportEnv.ZX_INIT = path.join(
        viberootsSourceRoot,
        "build-tools",
        "tools",
        "dev",
        "zx-init.mjs",
      );
      prependPath(exportEnv, buck2ShimDir);
      await prependTempRepoBin(exportEnv, tmp);
      prependPath(exportEnv, buck2ShimDir);
      const wantsUnifiedPnpmStore =
        String(process.env.TEST_DISABLE_UNIFIED_PNPM_STORE || "").trim() !== "1";
      if (wantsUnifiedPnpmStore) {
        const unified = await timeAsync("runInTemp ensureUnifiedPnpmStore", async () => {
          return await ensureUnifiedPnpmStoreOncePerWorker($);
        });
        const pnpmState = await timeAsync("runInTemp externalPnpmStateDirs", async () => {
          return await externalPnpmStateDirs(tmp);
        });
        tempPnpmStateRoot = pnpmState.rootDir;
        exportEnv.PNPM_HOME = exportEnv.PNPM_HOME || pnpmState.homeDir;
        if (unified) {
          exportEnv.LOCAL_PNPM_STORE = exportEnv.LOCAL_PNPM_STORE || unified;
          exportEnv.NIX_USE_PREFETCHED_PNPM_STORE = "1";
          exportEnv.npm_config_store_dir = exportEnv.npm_config_store_dir || unified;
          exportEnv.NPM_CONFIG_STORE_DIR = exportEnv.NPM_CONFIG_STORE_DIR || unified;
          exportEnv.npm_config_ignore_pnpmfile = exportEnv.npm_config_ignore_pnpmfile || "true";
          exportEnv.NPM_CONFIG_IGNORE_PNPMFILE = exportEnv.NPM_CONFIG_IGNORE_PNPMFILE || "true";
        }
      }

      const nodeOpts = [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        `--import ${exportEnv.ZX_INIT}`,
      ];
      exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
        .filter(Boolean)
        .join(" ");
      exportEnv = withGitAutoMaintenanceDisabledEnv(exportEnv);

      const needCgo =
        exportEnv.CGO_ENABLED === "1" || String(process.env.TEST_ENABLE_CGO || "").trim() === "1";
      if (needCgo) {
        try {
          const sdk = await getDarwinSdkPathOncePerWorker($);
          const tc = await getCgoToolchainPathsOncePerWorker($);
          if (sdk && process.platform === "darwin") {
            exportEnv.SDKROOT = exportEnv.SDKROOT || sdk;
            const base = `-isysroot ${sdk}`;
            exportEnv.CGO_CPPFLAGS = [base, exportEnv.CGO_CPPFLAGS || ""].filter(Boolean).join(" ");
            exportEnv.CGO_CFLAGS = [base, exportEnv.CGO_CFLAGS || ""].filter(Boolean).join(" ");
            const inc = `${sdk}/usr/include`;
            const lib = `${sdk}/usr/lib`;
            exportEnv.CPATH = [inc, exportEnv.CPATH || ""].filter(Boolean).join(path.delimiter);
            exportEnv.LIBRARY_PATH = [lib, exportEnv.LIBRARY_PATH || ""]
              .filter(Boolean)
              .join(path.delimiter);
            exportEnv.CC = exportEnv.CC || "xcrun --sdk macosx clang";
          }
          if (tc) {
            const isNix = (p: string) => !!p && p.startsWith("/nix/store/");
            if (isNix(tc.clang) && isNix(tc.clangxx)) {
              if (process.platform === "darwin") {
                if (isNix(tc.xcrun)) {
                  exportEnv.CC = `${tc.xcrun} --sdk macosx ${tc.clang}`;
                  exportEnv.CXX = `${tc.xcrun} --sdk macosx ${tc.clangxx}`;
                }
              } else {
                exportEnv.CC = tc.clang;
                exportEnv.CXX = tc.clangxx;
              }
            }
          }
        } catch {}
      }

      const forceZxProbe = String(process.env.TEST_FORCE_ZX_INIT_PROBE || "").trim() === "1";
      if ((process.env.TEST_NEED_DEV_ENV || "") === "1" || forceZxProbe) {
        await timeAsync("runInTemp ensureZxInitProbedOnce", async () => {
          await ensureZxInitProbedOnce({ tmp, $, exportEnv });
        });
      }
      cleanupCommand = $({ cwd: tmp, env: exportEnv });
      await timeAsync(
        "buck-daemon-reaper setup",
        async () => await ensureBuckReaperStarted(tmp, cleanupCommand),
      );

      return await timeAsync("runInTemp testBody", async () => {
        return await withTempProcessEnv(exportEnv, async () => await fn(tmp, cleanupCommand));
      });
    },
    async () => {
      const cleanup$ = cleanupCommand || $setup;
      let postRemoveBuckCleanupRoots: string[] = [];
      const steps: Array<() => Promise<void>> = [
        async () =>
          await timeAsync("temp process cleanup", async () => {
            await cleanupTempRepoProcesses({ roots: [tmp] });
          }),
        async () =>
          await timeAsync(
            "buck-daemon cleanup",
            async () => await killBuckDaemonsForRepo(tmp, cleanup$),
          ),
        async () => await consumerSnapshot?.cleanup(),
      ];
      if ((process.env.TEST_REWRITE_COVERAGE_TMP || "") === "1") {
        steps.push(async () =>
          timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () =>
            rewriteCoverageUrls(tmp),
          ),
        );
      }
      if (process.env.TEST_KEEP_TMP === "1") {
        steps.push(async () => {
          console.error(`KEEP_TMP ${tmp}`);
          await fsp.appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8");
        });
      } else {
        steps.push(
          async () => {
            postRemoveBuckCleanupRoots = await buckCleanupRootsForRepo(tmp);
          },
          async () => await removeTreeWithWritableFallback(tmp, $),
          async () => {
            if (tempPnpmStateRoot) await removeTreeWithWritableFallback(tempPnpmStateRoot, $);
          },
          async () =>
            await timeAsync("post-remove buck-daemon cleanup", async () => {
              await killBuckDaemonsForRoots(postRemoveBuckCleanupRoots, cleanup$);
            }),
        );
      }
      if (removeHome) steps.push(async () => await removeTreeWithWritableFallback(home, $));
      await runAsyncCleanupSteps(steps);
    },
  );
}

function registerRunInTempBuckIsolation(iso: string, repoRoot: string): void {
  const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (!stateFile || !iso) return;
  const ownerPidRaw = Number(process.env.VBR_VERIFY_OWNER_PID || process.pid);
  const ownerPid = Number.isFinite(ownerPidRaw) && ownerPidRaw > 1 ? ownerPidRaw : process.pid;
  try {
    registerBuckIsolationSync({
      stateFile,
      iso,
      repoRoot: path.resolve(repoRoot),
      ownerPid,
      kind: "run-in-temp-zxtest",
    });
  } catch {}
}

export async function runInScratchTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
): Promise<T> {
  return await runInTemp(name, fn, { workspace: "scratch", git: false });
}

export async function reconcileTempDependencyInputs(
  tmp: string,
  $tmp: any,
  sourceRoot = String(process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || ""),
): Promise<void> {
  const canonicalSourceRoot = sourceRoot
    ? await fsp.realpath(sourceRoot).catch(() => path.resolve(sourceRoot))
    : await activeViberootsRootFromWorkspace();
  const updateTool = path.join(canonicalSourceRoot, "build-tools", "tools", "dev", "update.ts");
  if (!(await pathExists(updateTool))) {
    throw new Error(`runInTemp: production u entry is missing: ${updateTool}`);
  }
  await $tmp({ cwd: tmp, stdio: "inherit" })`zx-wrapper ${updateTool}`;
}
