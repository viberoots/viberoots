#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { findNearestImporterLock, nodeModulesAttr } from "./install/common.ts";
import { resolveImporterDir } from "../lib/lockfiles.ts";

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
// Allow an explicit importer override for tests to reduce redundant per-importer builds.
// When set, it should be a repo-root-relative directory containing pnpm-lock.yaml, e.g., "libs/test-deps".
const overrideImporterRaw = (process.env.ZX_TEST_NODE_MODULES_IMPORTER || "").trim();
let importer = "";
if (overrideImporterRaw) {
  try {
    importer = await resolveImporterDir(cwd, overrideImporterRaw);
  } catch {
    // Fall back to nearest importer when override is invalid
    importer = "";
  }
}
if (!importer) {
  const info = await findNearestImporterLock(cwd);
  if (!info) {
    console.error(
      "node-modules-build: no pnpm-lock.yaml found near current directory; cannot resolve importer",
    );
    process.exit(2);
  }
  importer = info!.importer;
}
const fullAttr = nodeModulesAttr(importer);
const flakeRoot = await findFlakeRoot(cwd);
// Fast path: if output is already realized in the store, prefer path-info
let outPath = "";
try {
  const pi = await $`nix path-info ${flakeRoot}#${fullAttr} --accept-flake-config`;
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
  const cmd = [
    "set -euo pipefail;",
    'MJ="${NIX_MAX_JOBS:-0}";',
    'CR="${NIX_CORES:-0}";',
    'TS="${NIX_PNPM_FETCH_TIMEOUT:-900}";',
    'if ! command -v timeout >/dev/null 2>&1; then echo "node-modules-build: error: timeout not found on PATH" 1>&2; exit 127; fi;',
    'TO="timeout -k 10s ${TS}s ";',
    'JOBS_FLAG=""; if [ -n "$MJ" ] && [ "$MJ" != "0" ]; then JOBS_FLAG="--max-jobs $MJ"; fi;',
    'CORES_FLAG=""; if [ -n "$CR" ] && [ "$CR" != "0" ]; then CORES_FLAG="--option cores $CR"; fi;',
    `$TO nix build "${flakeRoot}#${fullAttr}" --no-link --accept-flake-config --builders "" --print-out-paths $JOBS_FLAG $CORES_FLAG`,
  ].join(" ");
  const built = await $`bash --noprofile --norc -c ${cmd}`.nothrow();
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
  // Attempt to reconcile pnpm-store FOD hash for the importer, then retry build once
  try {
    const relLock = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
    const updater = path.join(flakeRoot, "tools/dev/update-pnpm-hash.ts");
    await $({ cwd: flakeRoot })`zx-wrapper ${updater} --lockfile ${relLock}`.nothrow();
  } catch {}
  outPath = await tryBuild();
}
if (!outPath) {
  console.error("node-modules-build: nix build produced no output path");
  process.exit(2);
}
console.log(outPath);
