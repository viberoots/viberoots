#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { findNearestImporterLock, nodeModulesAttr } from "./install/common.ts";

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
const info = await findNearestImporterLock(cwd);
if (!info) {
  console.error(
    "node-modules-build: no pnpm-lock.yaml found near current directory; cannot resolve importer",
  );
  process.exit(2);
}
const importer = info!.importer;
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
  const built =
    await $`nix build ${flakeRoot}#${fullAttr} --no-link --accept-flake-config --print-out-paths`.nothrow();
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
    const relLock = info!.lockRel;
    const updater = path.join(flakeRoot, "tools/dev/update-pnpm-hash.ts");
    await $`zx-wrapper ${updater} --lockfile ${relLock}`.nothrow();
  } catch {}
  outPath = await tryBuild();
}
if (!outPath) {
  console.error("node-modules-build: nix build produced no output path");
  process.exit(2);
}
console.log(outPath);
