#!/usr/bin/env zx-wrapper
import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { nixBuilderPolicyShellArgs } from "../lib/nix-builder-policy";
import { resolveToolPathSync } from "../lib/tool-paths";
import {
  canonicalArtifactToolsRoot,
  buildCanonicalArtifactEnvironment,
} from "../lib/artifact-environment";
import { buildToolPath } from "./dev-build/paths";
import { inspectWorkspaceArtifactSource } from "./artifact-policy-inspection";
import { makeFilteredFlakeRef } from "./filtered-flake";
import {
  findNearestImporterLock,
  nodeModulesAttr,
  normalizeImporter,
  sanitizeName,
} from "./install/common";
import {
  currentVerifiedMarkerFingerprintCandidates,
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
      await fsp.access(path.join(dir, ".viberoots", "workspace", "flake.nix"));
      return dir;
    } catch {}
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

function argValue(name: string): string {
  const prefix = `${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = String(process.argv[i] || "");
    if (arg === name) return String(process.argv[i + 1] || "");
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return "";
}

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

const overrideImporterRaw = (
  process.env.ZX_TEST_NODE_MODULES_IMPORTER ||
  argValue("--importer") ||
  ""
).trim();
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
const lockfileRel = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
const hashKey = importer === "viberoots" ? "pnpm-lock.yaml" : lockfileRel;
const placeholderDigest = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
try {
  const chk = await $({
    cwd: flakeRoot,
    stdio: "pipe",
  })`git rev-parse --is-inside-work-tree`
    .nothrow()
    .quiet();
  if (String(chk.stdout || "").trim() !== "true") {
    throw new Error("not a git worktree");
  }
} catch {
  console.error(
    `node-modules-build: error: expected flake root to be a git worktree for fast deterministic evaluation: ${flakeRoot}`,
  );
  process.exit(2);
}
function liveMarkerRepoRoot(): string {
  const liveRoot = String(process.env.REPO_ROOT || "").trim();
  if (liveRoot && path.isAbsolute(liveRoot)) return path.resolve(liveRoot);
  return repoRoot;
}

async function readHashForLock(lockfileRel: string): Promise<string> {
  const hashFiles = [
    buildToolPath(flakeRoot, "tools/nix/node-modules.hashes.json"),
    path.join(flakeRoot, "projects", "config", "node-modules.hashes.json"),
  ];
  let found = "";
  for (const hashFile of hashFiles) {
    try {
      const raw = await fsp.readFile(hashFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, string>;
      found = parsed[lockfileRel] || found;
    } catch {}
  }
  return found;
}
async function hasFreshVerifiedMarker(lockfileRel: string, hashKey: string): Promise<boolean> {
  const importer = lockfileRel.includes("/")
    ? normalizeImporter(lockfileRel.slice(0, lockfileRel.lastIndexOf("/")))
    : ".";
  const marker = await readVerifiedMarker(verifiedMarkerPath(liveMarkerRepoRoot(), importer));
  if (!marker) return false;
  const lockHash = await sha256File(path.join(repoRoot, lockfileRel));
  if (!lockHash) return false;
  const builderFingerprint = await currentVerifiedMarkerFingerprint(repoRoot, importer);
  const acceptedBuilderFingerprints = await currentVerifiedMarkerFingerprintCandidates(
    repoRoot,
    importer,
  );
  const metadataMatches =
    marker.importer === importer &&
    marker.lockfile === hashKey &&
    marker.lockHash === lockHash &&
    marker.hashValue === (await readHashForLock(hashKey)) &&
    (marker.builderFingerprint === builderFingerprint ||
      acceptedBuilderFingerprints.includes(marker.builderFingerprint));
  if (!metadataMatches) return false;
  return true;
}

async function withNodeModulesEvaluationBundle<T>(
  fn: (flakeRef: string, env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const artifactToolsRoot = canonicalArtifactToolsRoot(
    repoRoot,
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const artifactEnv = buildCanonicalArtifactEnvironment(repoRoot, { artifactToolsRoot });
  const targetPackages = importer === "." ? [] : [importer];
  const inventory = await inspectWorkspaceArtifactSource({
    workspaceRoot: repoRoot,
    targetPackages,
    env: artifactEnv,
  });
  const target = importer === "." ? "" : `//${importer}:__node_modules__`;
  const graphPath = path.join(repoRoot, ".viberoots", "workspace", "buck", "graph.json");
  const source = await makeFilteredFlakeRef({
    workspaceRoot: repoRoot,
    attr: fullAttr,
    target,
    graphPath,
    logPrefix: "[node-modules-build]",
    classification: inventory.localDevelopment ? "local-development" : "hermetic",
    env: artifactEnv,
    selectorEnv: {},
  });
  try {
    return await fn(source.flakeRef, artifactEnv);
  } finally {
    await source.cleanup();
  }
}

async function recoverOutPathFromLinkMarker(
  importer: string,
  lockfileRel: string,
): Promise<string> {
  const markerKey = importer === "." ? "root" : sanitizeName(importer);
  const markerRoots = Array.from(
    new Set(
      [liveMarkerRepoRoot(), repoRoot, process.env.WORKSPACE_ROOT || ""]
        .map((root) => String(root || "").trim())
        .filter(Boolean)
        .map((root) => path.resolve(root)),
    ),
  );
  try {
    const lockBuf = await fsp.readFile(path.join(repoRoot, lockfileRel));
    const lockHash = crypto.createHash("sha256").update(lockBuf).digest("hex");
    for (const markerRoot of markerRoots) {
      const markerPath = path.join(
        markerRoot,
        ".viberoots",
        "workspace",
        "buck",
        "tmp",
        `node-modules-link.${markerKey}.json`,
      );
      try {
        const marker = JSON.parse(await fsp.readFile(markerPath, "utf8")) as {
          importer?: string;
          lockfile?: string;
          lockHash?: string;
          outPath?: string;
        };
        const outPath = String(marker.outPath || "").trim();
        if (
          marker.importer !== importer ||
          marker.lockfile !== lockfileRel ||
          marker.lockHash !== lockHash ||
          !outPath.startsWith("/nix/store/")
        ) {
          continue;
        }
        await fsp.access(path.join(outPath, "node_modules"));
        return outPath;
      } catch {}
    }
  } catch {}
  return "";
}

function runInstallDiagnostic(lockfileRel: string, reason: string): string {
  return [
    `node-modules-build: pnpm-store state for ${lockfileRel} is ${reason}.`,
    "node-modules-build: run `u` to refresh pnpm hashes and materialize final pnpm stores, then rerun `b`.",
  ].join("\n");
}

async function requireFreshPnpmStoreState(lockfileRel: string, hashKey: string): Promise<void> {
  const current = await readHashForLock(hashKey);
  if (!current || current === placeholderDigest) {
    console.error(runInstallDiagnostic(lockfileRel, "missing or placeholder-hashed"));
    process.exit(2);
  }
  if (!(await hasFreshVerifiedMarker(lockfileRel, hashKey))) {
    console.error(runInstallDiagnostic(lockfileRel, "stale or unverified"));
    process.exit(2);
  }
}

// Fast path: if output is already realized in the store, prefer path-info
let outPath = "";
await requireFreshPnpmStoreState(lockfileRel, hashKey);
outPath = await recoverOutPathFromLinkMarker(importer, lockfileRel);
async function tryBuild(flakeRef: string, env: NodeJS.ProcessEnv): Promise<string> {
  const timeoutPath = resolveToolPathSync("timeout", env);
  const nixBin = resolveToolPathSync("nix", env);
  const cmd = [
    "set -euo pipefail;",
    'TIMEOUT_PATH="$1";',
    'FLAKE_REF="$2";',
    'FULL_ATTR="$3";',
    'NIX_BIN="$4";',
    'MJ="${NIX_MAX_JOBS:-0}";',
    'CR="${NIX_CORES:-0}";',
    'TS="${NIX_PNPM_FETCH_TIMEOUT:-900}";',
    'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
    'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
    `"$TIMEOUT_PATH" -k 10s "\${TS}s" "$NIX_BIN" build "\${FLAKE_REF}" --no-link --accept-flake-config ${nixBuilderPolicyShellArgs("local_only")} --print-out-paths $JOBS_FLAG $CORES_FLAG`,
  ].join(" ");
  const built = await $({
    env,
  })`bash --noprofile --norc -c ${cmd} -- ${timeoutPath} ${flakeRef} ${fullAttr} ${nixBin}`.nothrow();
  const txt = String(built.stdout || "").trim();
  if (built.exitCode === 0 && txt) {
    return txt.split("\n").filter(Boolean).pop() || "";
  }
  return "";
}

if (!outPath) {
  outPath = await withNodeModulesEvaluationBundle(async (flakeRef, env) => {
    try {
      const nixBin = resolveToolPathSync("nix", env);
      const pi = await $({ env })`${nixBin} path-info ${flakeRef} --accept-flake-config`;
      const candidate =
        String(pi.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
      if (candidate) await fsp.access(candidate);
      return candidate;
    } catch {
      return await tryBuild(flakeRef, env);
    }
  });
}
if (!outPath) {
  console.error("node-modules-build: nix build produced no output path");
  process.exit(2);
}
console.log(outPath);
