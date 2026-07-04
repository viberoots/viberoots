import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBuckConfigForTempRepo, ensureWorkspaceRootEnvFile } from "./buck-config";
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
import { shSingleQuote } from "./shell-quote";
import { timeAsync } from "./timing";
import { ensureToolchainPathsForTempRepo } from "./toolchain-paths";
import { mktemp } from "./tmp";
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
import { mkdirWithMacosMetadataExclusion } from "../../../lib/macos-metadata";
import { ensureWorkspaceProvidersPackage } from "../../../lib/workspace-providers-package";

const LOCAL_FIXTURE_SERVICE_ENV = "VBR_DEPLOY_LOCAL_FIXTURE_SERVICE";
const PREPARED_SEED_MARKER = ".seed-store-prepared-v7";

let cachedDevEnvExport: Promise<string> | null = null;
type PathFlakeMetadata = {
  lastModified?: number;
  narHash?: string;
};
let cachedPinnedNixpkgsPath: Promise<string> | null = null;
let cachedPinnedCacertPath: Promise<string> | null = null;
let cachedUnifiedPnpmStorePath: Promise<string> | null = null;
let envMutationQueue: Promise<void> = Promise.resolve();
const preNoindexStableRootCleanup = new Set<string>();

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

async function exportDevEnvOncePerWorker($: any): Promise<string> {
  if (cachedDevEnvExport) return await cachedDevEnvExport;
  cachedDevEnvExport = exportDevEnvWithRetry($).catch((err) => {
    cachedDevEnvExport = null;
    throw err;
  });
  return await cachedDevEnvExport;
}

async function exportDevEnvWithRetry($: any): Promise<string> {
  const devEnvRoot = await activeViberootsRootFromWorkspace();
  const runOnce = async () => {
    // Avoid direnv here: it can be slow and re-run per temp repo, while nix develop is deterministic.
    const nixOut = await $({
      cwd: devEnvRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: withSanitizedInheritedNixConfig({
        ...process.env,
        IN_NIX_SHELL: "1",
        VIBEROOTS_ROOT: devEnvRoot,
        VIBEROOTS_SOURCE_ROOT: devEnvRoot,
        VIBEROOTS_FLAKE_INPUT_ROOT: devEnvRoot,
      }),
    })`nix develop --no-write-lock-file --accept-flake-config -c env -0`;
    if (Number(nixOut.exitCode || 0) !== 127) return nixOut;
    return await $({
      cwd: devEnvRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: withSanitizedInheritedNixConfig({
        ...process.env,
        IN_NIX_SHELL: "1",
        VIBEROOTS_ROOT: devEnvRoot,
        VIBEROOTS_SOURCE_ROOT: devEnvRoot,
        VIBEROOTS_FLAKE_INPUT_ROOT: devEnvRoot,
      }),
    })`bash --noprofile --norc -c 'if command -v direnv >/dev/null 2>&1; then eval "$(direnv export bash)"; env -0; else printf ""; fi'`;
  };
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
  return root;
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
  activeViberootsRoot: string,
): Promise<string[]> {
  const touched: string[] = [];
  const flakePath = await workspaceFlakePath(tmp);
  const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
  if (!text) return [];
  let next = text.replace(
    /(\bviberoots\.url\s*=\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"path:${activeViberootsRoot}"`,
  );
  if (!next.includes('"VIBEROOTS_FLAKE_INPUT_ROOT"')) {
    next = next.replace(/(\s*"VIBEROOTS_SOURCE_ROOT"\n)/, '$1    "VIBEROOTS_FLAKE_INPUT_ROOT"\n');
  }
  if (next !== text) {
    await fsp.writeFile(flakePath, next, "utf8");
    touched.push(relFromTempRoot(tmp, flakePath));
  }
  touched.push(...(await rewriteTempViberootsLockInput(tmp, activeViberootsRoot)));
  return uniqueRelPaths(touched);
}

async function readPathFlakeMetadata(inputPath: string): Promise<PathFlakeMetadata> {
  const canonicalInputPath = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await $({
    stdio: "pipe",
  })`nix flake prefetch --json ${`path:${canonicalInputPath}`}`.nothrow();
  if (prefetched.exitCode === 0) {
    const parsed = JSON.parse(String(prefetched.stdout || "{}"));
    const locked = parsed?.locked || {};
    return {
      lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
      narHash: typeof locked.narHash === "string" ? locked.narHash : undefined,
    };
  }
  const out = await $({
    stdio: "pipe",
  })`nix flake metadata --json ${`path:${canonicalInputPath}`} --no-write-lock-file`;
  const parsed = JSON.parse(String(out.stdout || "{}"));
  const locked = parsed?.locked || {};
  const narHash =
    typeof locked.narHash === "string"
      ? locked.narHash
      : String(
          (
            await $({
              stdio: "pipe",
            })`nix hash path --sri ${canonicalInputPath}`
          ).stdout || "",
        ).trim();
  return {
    lastModified: typeof locked.lastModified === "number" ? locked.lastModified : undefined,
    narHash: narHash || undefined,
  };
}

function rewriteLocalPathLockEntry(
  entry: unknown,
  activeViberootsRoot: string,
  metadata?: PathFlakeMetadata,
): boolean {
  if (!entry || typeof entry !== "object") return false;
  const node = entry as { type?: unknown; path?: unknown; url?: unknown };
  const rawPath =
    node.type === "path"
      ? String(node.path || "")
      : node.type === "git" && String(node.url || "").startsWith("file:")
        ? String(node.url || "").replace(/^file:/, "")
        : "";
  if (!rawPath) return false;
  const base = path.basename(rawPath);
  if (base !== "viberoots" && !isGeneratedFilteredViberootsInputPath(rawPath)) return false;
  const mutableNode = node as {
    lastModified?: number;
    lastModifiedDate?: string;
    narHash?: string;
    path: unknown;
    rev?: string;
    revCount?: number;
    type: unknown;
    url?: string;
  };
  mutableNode.type = "path";
  mutableNode.path = activeViberootsRoot;
  if (metadata?.lastModified) mutableNode.lastModified = metadata.lastModified;
  if (metadata?.narHash) mutableNode.narHash = metadata.narHash;
  delete mutableNode.lastModifiedDate;
  delete mutableNode.rev;
  delete mutableNode.revCount;
  delete mutableNode.url;
  return true;
}

async function rewriteTempViberootsLockInput(
  tmp: string,
  activeViberootsRoot: string,
): Promise<string[]> {
  const lockPath = await workspaceFlakeLockPath(tmp);
  const text = await fsp.readFile(lockPath, "utf8").catch(() => "");
  if (!text) return [];
  let lock: any;
  try {
    lock = JSON.parse(text);
  } catch {
    return [];
  }
  const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
  const node = lock?.nodes?.[inputName] || lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
  if (!node || typeof node !== "object") return [];
  const metadata = await readPathFlakeMetadata(activeViberootsRoot);
  const lockedChanged = rewriteLocalPathLockEntry(node.locked, activeViberootsRoot, metadata);
  const originalChanged = rewriteLocalPathLockEntry(node.original, activeViberootsRoot);
  const changed = lockedChanged || originalChanged;
  if (!changed) return [];
  await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  return [relFromTempRoot(tmp, lockPath)];
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
    return await fsp.mkdtemp(path.join(homeBase, "home-"));
  })();
  return await stableTestHomeOnce;
}

async function resolveTestHome(): Promise<{ home: string; removeOnExit: boolean }> {
  if (String(process.env.TEST_HOME_PER_TEST || "").trim() === "1") {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    return { home, removeOnExit: true };
  }
  const home = await stableTestHomeOncePerWorker();
  return { home, removeOnExit: false };
}

async function removeTreeWithWritableFallback(target: string, $: any): Promise<void> {
  try {
    await fsp.rm(target, { recursive: true, force: true });
    return;
  } catch {
    // Only pay the recursive chmod cost when deletion actually fails.
    try {
      const q = shSingleQuote(target);
      await $({
        stdio: "ignore",
        cwd: process.cwd(),
        reject: false,
        nothrow: true,
      })`bash --noprofile --norc -c ${`chmod -R u+w ${q} >/dev/null 2>&1 || true`}`;
    } catch {}
    await fsp.rm(target, { recursive: true, force: true }).catch((err) => {
      console.warn("warning: failed to remove temp test dir:", err);
    });
  }
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
  opts?: { git?: boolean; workspace?: "seeded" | "scratch" },
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
    await rewriteTempViberootsInput(tmp, activeViberootsRoot);
    await prependTempRepoBin(exportEnv, tmp);
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
  const viberootsInputPath = seedStoreViberootsRoot || tempViberootsRoot || activeViberootsRoot;
  tempSetupEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInputPath;
  tempSetupEnv.ZX_INIT = path.join(
    viberootsSourceRoot,
    "build-tools",
    "tools",
    "dev",
    "zx-init.mjs",
  );
  await timeAsync("runInTemp rewriteTempViberootsInput", async () => {
    seedTouchedRelPaths.push(...(await rewriteTempViberootsInput(tmp, viberootsInputPath)));
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
      viberootsInputRoot: viberootsInputPath,
      viberootsSourceRoot,
    });
  });
  await timeAsync("runInTemp ensureWorkspaceProvidersPackage", async () => {
    await ensureWorkspaceProvidersPackage(tmp);
  });
  await timeAsync("runInTemp ensureWorkspaceRootEnvFile", async () => {
    await ensureWorkspaceRootEnvFile(tmp, viberootsSourceRoot, viberootsInputPath);
  });
  await timeAsync("runInTemp ensureToolchainPathsForTempRepo", async () => {
    await ensureToolchainPathsForTempRepo(tmp, $setup);
  });
  await timeAsync("runInTemp rewriteTempViberootsInput after setup", async () => {
    await rewriteTempViberootsInput(tmp, viberootsInputPath);
  });

  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    const flakeRef = await workspaceFlakeRef(tmp);
    const viberootsOverrideArgs = ["--override-input", "viberoots", `path:${viberootsInputPath}`];
    const chk = await retryTransientNixStoreFailure(
      "checking temp repo buck2-prelude",
      async () =>
        await $setup`nix build ${`path:${flakeRef}#buck2-prelude`} ${viberootsOverrideArgs} --no-link --no-write-lock-file --accept-flake-config --print-build-logs`.nothrow(),
      (out) => `${(out as any).stdout || ""}\n${(out as any).stderr || ""}`,
      (out) => Number((out as any).exitCode || 0) !== 0,
    );
    if (chk.exitCode !== 0) {
      const detail = `${String(chk.stdout || "")}\n${String(chk.stderr || "")}`.trim();
      throw new Error(
        [
          "dev-shell check failed: nix build path:<tmp>#buck2-prelude did not succeed in temp repo; ensure direnv/dev shell is active",
          detail,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }

  let envOut: any = { stdout: "" };
  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    envOut = await timeAsync(`devEnvExport(${path.basename(tmp)})`, async () => {
      return { stdout: await exportDevEnvOncePerWorker($) };
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
    const viberootsInputNodeModules = path.join(viberootsInputPath, "node_modules");
    exportEnv.NODE_PATH = [
      wsNodeModules,
      activeViberootsNodeModules,
      viberootsSourceNodeModules,
      viberootsInputNodeModules,
      exportEnv.NODE_PATH || "",
    ]
      .filter(Boolean)
      .join(path.delimiter);
  } catch {}
  exportEnv.WORKSPACE_ROOT = tmp;
  exportEnv.BUCK_TEST_SRC = tmp;
  exportEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
  exportEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
  exportEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInputPath;
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
    exportEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
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
  exportEnv.ZX_INIT = path.join(viberootsSourceRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  prependPath(exportEnv, buck2ShimDir);
  await prependTempRepoBin(exportEnv, tmp);
  prependPath(exportEnv, buck2ShimDir);
  const wantsUnifiedPnpmStore =
    String(process.env.TEST_DISABLE_UNIFIED_PNPM_STORE || "").trim() !== "1";
  let tempPnpmStateRoot: string | null = null;
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
  const _$ = $({ cwd: tmp, env: exportEnv });
  await timeAsync("buck-daemon-reaper setup", async () => await ensureBuckReaperStarted(tmp, _$));

  try {
    return await timeAsync("runInTemp testBody", async () => {
      return await withTempProcessEnv(exportEnv, async () => await fn(tmp, _$));
    });
  } finally {
    await timeAsync("temp process cleanup", async () => {
      await cleanupTempRepoProcesses({ roots: [tmp] }).catch(() => {});
    });
    await timeAsync("buck-daemon cleanup", async () => await killBuckDaemonsForRepo(tmp, _$));
    if ((process.env.TEST_REWRITE_COVERAGE_TMP || "") === "1") {
      await timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () =>
        rewriteCoverageUrls(tmp).catch(() => {}),
      );
    }
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        console.error(`KEEP_TMP ${tmp}`);
        await fsp
          .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
          .catch(() => {});
      } catch {}
    } else {
      const postRemoveBuckCleanupRoots = await buckCleanupRootsForRepo(tmp);
      await removeTreeWithWritableFallback(tmp, $);
      if (tempPnpmStateRoot) {
        await removeTreeWithWritableFallback(tempPnpmStateRoot, $);
      }
      await timeAsync("post-remove buck-daemon cleanup", async () => {
        await killBuckDaemonsForRoots(postRemoveBuckCleanupRoots, _$);
      });
    }
    if (removeHome) {
      await removeTreeWithWritableFallback(home, $);
    }
  }
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
