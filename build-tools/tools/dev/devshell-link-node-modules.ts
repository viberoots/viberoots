#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { findNearestImporterLock } from "./install/common";

type Marker = {
  importer: string;
  lockfile: string;
  lockHash: string;
  outPath: string;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMarker(file: string): Promise<Marker | null> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const data = JSON.parse(raw) as Marker;
    if (
      data &&
      typeof data.importer === "string" &&
      typeof data.lockfile === "string" &&
      typeof data.lockHash === "string" &&
      typeof data.outPath === "string"
    ) {
      return data;
    }
  } catch {}
  return null;
}

async function hashFile(file: string): Promise<string> {
  const buf = await fsp.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function readSymlinkTarget(linkPath: string): Promise<string> {
  try {
    return await fsp.readlink(linkPath);
  } catch {
    return "";
  }
}

async function ensureSymlink(target: string, linkPath: string): Promise<boolean> {
  const exists = await pathExists(linkPath);
  if (exists) {
    const st = await fsp.lstat(linkPath);
    if (!st.isSymbolicLink()) {
      console.error("(devShell) existing non-symlink node_modules detected; not overwriting");
      return false;
    }
    const cur = await readSymlinkTarget(linkPath);
    if (cur === target) return true;
  }
  await fsp.rm(linkPath, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(target, linkPath);
  return true;
}

function isTruthy(value: string | undefined): boolean {
  return String(value || "").trim() !== "";
}

async function main() {
  if (isTruthy(process.env.NO_NODE_MODULES_LINK)) return;
  const cwd = process.cwd();
  const envRoot = String(process.env.WORKSPACE_ROOT || "").trim();
  const envRootAbs = envRoot ? path.resolve(envRoot) : "";
  const cwdAbs = path.resolve(cwd);
  const repoRoot =
    envRootAbs && (cwdAbs === envRootAbs || cwdAbs.startsWith(envRootAbs + path.sep))
      ? envRootAbs
      : await findRepoRoot(cwd);
  if (path.resolve(cwd) !== path.resolve(repoRoot)) return;

  const tmpRoot = path.resolve(os.tmpdir());
  const isTmp =
    path.resolve(repoRoot) === tmpRoot || path.resolve(repoRoot).startsWith(tmpRoot + path.sep);
  const allowTmp = String(process.env.BNX_DEVSHELL_ALLOW_TMP || "").trim() === "1";
  if (isTmp && !allowTmp) return;

  const lockInfo = await findNearestImporterLock(cwd);
  const importer = lockInfo?.importer || ".";
  const lockRel = lockInfo?.lockRel || "";
  const lockAbs = lockRel ? path.join(repoRoot, lockRel) : "";
  const lockHash = lockAbs && (await pathExists(lockAbs)) ? await hashFile(lockAbs) : "";

  const markerPath = path.join(repoRoot, "buck-out", "tmp", "node-modules-link.root.json");
  const marker = await readMarker(markerPath);
  const markerValid =
    lockRel &&
    lockHash &&
    marker &&
    marker.lockfile === lockRel &&
    marker.lockHash === lockHash &&
    marker.outPath &&
    (await pathExists(path.join(marker.outPath, "node_modules")));

  let outPath = markerValid ? marker?.outPath || "" : "";

  if (!outPath) {
    const existing = await readSymlinkTarget(path.join(cwd, "node_modules"));
    if (existing && existing.endsWith(`${path.sep}node_modules`)) {
      const parent = path.dirname(existing);
      if (await pathExists(path.join(parent, "node_modules"))) outPath = parent;
    }
  }

  if (!outPath) return;
  const target = path.join(outPath, "node_modules");
  if (!(await pathExists(target))) return;
  const ok = await ensureSymlink(target, path.join(cwd, "node_modules"));
  if (!ok) return;

  if (!markerValid) return;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
