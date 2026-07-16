import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../../../lib/repo";
import { externalPnpmStateDirs } from "../../../../lib/pnpm-state-paths";
import { timeAsync } from "../timing";
import { PREPARED_SEED_MARKER } from "../seed-store-config";
import { relFromTempRoot, uniqueRelPaths } from "./flake-rewrite";

let cachedUnifiedPnpmStorePath: Promise<string> | null = null;
export async function removeInheritedBuildToolsSymlink(tmp: string): Promise<string[]> {
  const buildTools = path.join(tmp, "build-tools");
  const st = await fsp.lstat(buildTools).catch(() => null);
  if (st?.isSymbolicLink()) {
    await fsp.rm(buildTools, { force: true });
    return ["build-tools"];
  }
  return [];
}

export async function removeCppReqsIfRequested(tmp: string): Promise<string[]> {
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

export async function trackedNpmrcDirs(tmp: string): Promise<string[]> {
  const out = await $({ cwd: tmp, stdio: "pipe" })`git ls-files -- "**/.npmrc"`.nothrow().quiet();
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((rel) => path.join(tmp, path.dirname(rel)));
}

export async function ensurePnpmfilePlaceholders(tmp: string): Promise<string[]> {
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

export async function unifiedPnpmStoreFromRepoRoot(repoRoot: string): Promise<string> {
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

export async function ensureUnifiedPnpmStoreOncePerWorker($: any): Promise<string> {
  if (cachedUnifiedPnpmStorePath) return await cachedUnifiedPnpmStorePath;
  cachedUnifiedPnpmStorePath = (async () => {
    const repoRoot = process.cwd();
    const existing = await unifiedPnpmStoreFromRepoRoot(repoRoot);
    return existing;
  })();
  return await cachedUnifiedPnpmStorePath;
}

export function nixPathHasNixpkgsEntry(value: string): boolean {
  return String(value || "")
    .split(":")
    .map((entry) => entry.trim())
    .some((entry) => entry.startsWith("nixpkgs="));
}

export async function configureTempPnpmEnv(
  env: Record<string, string>,
  tmp: string,
  $: any,
): Promise<string | null> {
  if (String(process.env.TEST_DISABLE_UNIFIED_PNPM_STORE || "").trim() === "1") return null;
  const unified = await timeAsync(
    "runInTemp ensureUnifiedPnpmStore",
    async () => await ensureUnifiedPnpmStoreOncePerWorker($),
  );
  const state = await timeAsync(
    "runInTemp externalPnpmStateDirs",
    async () => await externalPnpmStateDirs(tmp),
  );
  env.PNPM_HOME = env.PNPM_HOME || state.homeDir;
  if (unified) {
    env.LOCAL_PNPM_STORE = env.LOCAL_PNPM_STORE || unified;
    env.NIX_USE_PREFETCHED_PNPM_STORE = "1";
    env.npm_config_store_dir = env.npm_config_store_dir || unified;
    env.NPM_CONFIG_STORE_DIR = env.NPM_CONFIG_STORE_DIR || unified;
    env.npm_config_ignore_pnpmfile = env.npm_config_ignore_pnpmfile || "true";
    env.NPM_CONFIG_IGNORE_PNPMFILE = env.NPM_CONFIG_IGNORE_PNPMFILE || "true";
  }
  return state.rootDir;
}
