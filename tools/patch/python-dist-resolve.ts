#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { ResolveResult } from "./types";
import { parseUvLockKeys } from "../lib/uv-lock.ts";
import { repoRoot as _repoRoot } from "./lib/apply";
import { createDbg } from "./lib/util";

const dbg = createDbg("python-dist-resolve");

function repoRoot(): string {
  return _repoRoot();
}

function normName(s: string): string {
  // Lowercase and treat '-' and '_' as equivalent per packaging norms
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

async function findNearestUvLock(importerFlag?: string): Promise<string> {
  const root = repoRoot();
  const base = importerFlag
    ? path.isAbsolute(importerFlag)
      ? importerFlag
      : path.join(root, importerFlag)
    : process.cwd();
  let cur = path.resolve(base);
  // Walk up to the repo root
  for (;;) {
    const candidate = path.join(cur, "uv.lock");
    try {
      await fsp.access(candidate);
      const rel = path.relative(root, candidate).replace(/\\/g, "/");
      return rel.startsWith("..") ? candidate : path.join(root, rel);
    } catch {}
    const next = path.dirname(cur);
    if (next === cur) break;
    // stop if leaving repo root
    if (path.relative(root, next).startsWith("..")) break;
    cur = next;
  }
  throw new Error(
    "uv.lock not found. Run inside a Python importer or pass --importer <dir> where uv.lock exists.",
  );
}

export async function resolvePythonDist(
  distName: string,
  importerFlag?: string,
): Promise<ResolveResult & { importerDir: string; lockfilePath: string }> {
  const lockAbs = await findNearestUvLock(importerFlag);
  const importerDir = path.dirname(lockAbs);
  const keys = await parseUvLockKeys(lockAbs);
  const want = normName(distName);
  let hitVersion = "";
  for (const k of keys) {
    const at = k.lastIndexOf("@");
    if (at <= 0) continue;
    const name = k.slice(0, at).toLowerCase();
    const ver = k.slice(at + 1).toLowerCase();
    if (normName(name) === want) {
      hitVersion = ver;
      break;
    }
  }
  if (!hitVersion) {
    throw new Error(`distribution not found in ${path.relative(repoRoot(), lockAbs)}: ${distName}`);
  }
  // Origin resolution strategy:
  // - Tests/dev: honor NIX_PY_TEST_RESOLVE_JSON mapping {"<name>": {"version":"..","originPath":".."}} or {"<name>@<ver>": {"originPath":".."}}
  // - Otherwise, error out with guidance (backend build will still apply patches by filename)
  const testJson = String(process.env.NIX_PY_TEST_RESOLVE_JSON || "").trim();
  let originPath = "";
  if (testJson) {
    try {
      const map = JSON.parse(testJson) as Record<string, { version?: string; originPath: string }>;
      const byName = map[distName] || map[normName(distName)];
      const byKey = map[`${normName(distName)}@${hitVersion}`];
      const ent = byKey || byName;
      if (ent?.originPath) {
        originPath = ent.originPath;
      }
    } catch {}
  }
  if (!originPath) {
    throw new Error(
      `cannot resolve pristine source for ${distName}@${hitVersion}. In tests, set NIX_PY_TEST_RESOLVE_JSON.`,
    );
  }
  const result: ResolveResult & { importerDir: string; lockfilePath: string } = {
    importPath: normName(distName),
    version: hitVersion,
    originPath,
    importerDir,
    lockfilePath: lockAbs,
  };
  dbg("resolvePythonDist", result);
  return result;
}
