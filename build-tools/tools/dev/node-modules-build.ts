#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveToolPathSync } from "../lib/tool-paths";
import { findNearestImporterLock, nodeModulesAttr } from "./install/common";
import {
  currentVerifiedMarkerFingerprint,
  readVerifiedMarker,
  sha256File,
  verifiedMarkerPath,
} from "./update-pnpm-hash/verified-marker";

async function findFlakeRoot(start: string): Promise<string> {
  let dir = path.resolve(start);
  const root = path.parse(dir).root;
  while (true) {
    try {
      await fsp.access(path.join(dir, "flake.nix"));
      return dir;
    } catch {}
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return start;
}

const cwd = process.cwd();
const flakeRoot = await findFlakeRoot(cwd);
const repoRoot = path.resolve(flakeRoot);

async function hasPnpmLock(dir: string): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, "pnpm-lock.yaml"));
    return true;
  } catch {
    return false;
  }
}

function toPosixRel(fromRootAbs: string, absDir: string): string {
  const rel = path.relative(fromRootAbs, absDir);
  const norm = rel.replace(/\\/g, "/");
  return norm === "" ? "." : norm;
}

async function resolveImporterInRepo(
  rootAbs: string,
  startCwd: string,
  override?: string,
): Promise<string> {
  const root = path.resolve(rootAbs);
  const startAbs = path.isAbsolute(startCwd) ? startCwd : path.resolve(root, startCwd || ".");

  const raw = String(override || "").trim();
  if (raw) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
    if (await hasPnpmLock(abs)) {
      return toPosixRel(root, abs);
    }
  }

  let cur = startAbs;
  while (true) {
    if (await hasPnpmLock(cur)) return toPosixRel(root, cur);
    const next = path.dirname(cur);
    if (next === cur) break;
    const relToRoot = path.relative(root, next);
    if (relToRoot.startsWith("..")) break;
    cur = next;
  }

  throw new Error(
    "node-modules-build: cannot determine importer directory; run inside an importer or pass --importer <dir>",
  );
}

const overrideImporterRaw = (process.env.ZX_TEST_NODE_MODULES_IMPORTER || "").trim();
let importer = "";
if (overrideImporterRaw) {
  try {
    importer = await resolveImporterInRepo(repoRoot, cwd, overrideImporterRaw);
  } catch {
    importer = "";
  }
}
if (!importer) {
  try {
    importer = await resolveImporterInRepo(repoRoot, cwd);
  } catch {
    const info = await findNearestImporterLock(cwd);
    if (!info) {
      console.error(
        "node-modules-build: no pnpm-lock.yaml found near current directory; cannot resolve importer",
      );
      process.exit(2);
    }
    importer = info!.importer;
  }
}
const fullAttr = nodeModulesAttr(importer);
const relLock = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
const placeholderDigest = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
try {
  const chk = await $({
    cwd: flakeRoot,
    stdio: "pipe",
  })`git rev-parse --is-inside-work-tree`.nothrow();
  if (String(chk.stdout || "").trim() !== "true") {
    throw new Error("not a git worktree");
  }
} catch {
  console.error(
    `node-modules-build: error: expected flake root to be a git worktree for fast deterministic evaluation: ${flakeRoot}`,
  );
  process.exit(2);
}
const flakeRef = flakeRoot;
async function readHashForLock(lockfileRel: string): Promise<string> {
  const hashFile = path.join(flakeRoot, "build-tools", "tools", "nix", "node-modules.hashes.json");
  try {
    const raw = await fsp.readFile(hashFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[lockfileRel] || "";
  } catch {
    return "";
  }
}
async function hasFreshVerifiedMarker(lockfileRel: string): Promise<boolean> {
  const importer = lockfileRel.includes("/")
    ? lockfileRel.slice(0, lockfileRel.lastIndexOf("/"))
    : ".";
  const marker = await readVerifiedMarker(verifiedMarkerPath(repoRoot, importer));
  if (!marker) return false;
  const lockHash = await sha256File(path.join(repoRoot, lockfileRel));
  if (!lockHash) return false;
  const builderFingerprint = await currentVerifiedMarkerFingerprint(repoRoot, importer);
  return (
    marker.importer === importer &&
    marker.lockfile === lockfileRel &&
    marker.lockHash === lockHash &&
    marker.hashValue === (await readHashForLock(lockfileRel)) &&
    marker.builderFingerprint === builderFingerprint
  );
}

async function ensurePnpmStoreHash(lockfileRel: string): Promise<void> {
  const current = await readHashForLock(lockfileRel);
  if (current && current !== placeholderDigest) {
    if (await hasFreshVerifiedMarker(lockfileRel)) return;
  }
  const update = await runPnpmHashUpdater(lockfileRel);
  if (update.exitCode !== 0) {
    console.error("node-modules-build: pnpm-store hash update failed");
    if (update.stdout) console.error(String(update.stdout).trim());
    if (update.stderr) console.error(String(update.stderr).trim());
    process.exit(2);
  }
  const next = await readHashForLock(lockfileRel);
  if (!next || next === placeholderDigest) {
    console.error(
      `node-modules-build: pnpm-store hash still placeholder after update for ${lockfileRel}`,
    );
    process.exit(2);
  }
  await stageNodeModulesHashesJson();
}

async function runPnpmHashUpdater(lockfileRel: string, force = false) {
  const updater = path.join(flakeRoot, "build-tools/tools/dev/update-pnpm-hash.ts");
  return await $({
    cwd: flakeRoot,
  })`zx-wrapper ${updater} --lockfile ${lockfileRel} ${force ? "--force" : ""}`.nothrow();
}

async function forceRefreshPnpmStoreHash(lockfileRel: string): Promise<void> {
  const update = await runPnpmHashUpdater(lockfileRel, true);
  if (update.exitCode !== 0) {
    console.error("node-modules-build: forced pnpm-store hash update failed");
    if (update.stdout) console.error(String(update.stdout).trim());
    if (update.stderr) console.error(String(update.stderr).trim());
    process.exit(2);
  }
  await stageNodeModulesHashesJson();
}

async function stageNodeModulesHashesJson(): Promise<void> {
  const hashFile = path.join(flakeRoot, "build-tools", "tools", "nix", "node-modules.hashes.json");
  try {
    await fsp.access(hashFile);
    await $({ cwd: flakeRoot })`git add ${hashFile}`.nothrow();
  } catch {}
}
// Fast path: if output is already realized in the store, prefer path-info
let outPath = "";
await ensurePnpmStoreHash(relLock);
try {
  const pi = await $`nix path-info ${flakeRef}#${fullAttr} --accept-flake-config`;
  const cand =
    String(pi.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  if (cand) {
    try {
      await fsp.access(cand);
      outPath = cand;
    } catch {}
  }
} catch {}
async function tryBuild(): Promise<string> {
  const timeoutPath = resolveToolPathSync("timeout");
  const cmd = [
    "set -euo pipefail;",
    'TIMEOUT_PATH="$1";',
    'FLAKE_REF="$2";',
    'FULL_ATTR="$3";',
    'MJ="${NIX_MAX_JOBS:-0}";',
    'CR="${NIX_CORES:-0}";',
    'TS="${NIX_PNPM_FETCH_TIMEOUT:-900}";',
    'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
    'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
    '"$TIMEOUT_PATH" -k 10s "${TS}s" nix build "${FLAKE_REF}#${FULL_ATTR}" --no-link --accept-flake-config --builders "" --print-out-paths $JOBS_FLAG $CORES_FLAG',
  ].join(" ");
  const built =
    await $`bash --noprofile --norc -c ${cmd} -- ${timeoutPath} ${flakeRef} ${fullAttr}`.nothrow();
  const txt = String(built.stdout || "").trim();
  if (built.exitCode === 0 && txt) {
    return txt.split("\n").filter(Boolean).pop() || "";
  }
  return "";
}

if (!outPath) {
  outPath = await tryBuild();
}

if (!outPath) {
  await forceRefreshPnpmStoreHash(relLock);
  outPath = await tryBuild();
}
if (!outPath) {
  console.error("node-modules-build: nix build produced no output path");
  process.exit(2);
}
console.log(outPath);
