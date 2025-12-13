import fs from "node:fs";
import path from "node:path";
import { sanitizeName } from "../install/common.ts";

export function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // If the path doesn't exist yet (e.g., transient in temp), normalize segments instead
    return path.resolve(p);
  }
}

export function normalizeImporter(imp: string): string {
  if (!imp) return ".";
  // If absolute or contains temp prefixes, try to extract apps/* or libs/*
  const m = imp.match(/(?:^|\/)((apps|libs)\/[A-Za-z0-9._-]+)(?:\/.+)?$/);
  if (m && m[1]) return m[1];
  // If already relative like apps/x or libs/y keep it
  if (/^(apps|libs)\/[A-Za-z0-9._-]+$/.test(imp)) return imp;
  // Fallback to "." (root importer)
  return ".";
}

export function importerFromLockfile(lockArg: string): string {
  // Resolve potential macOS /var vs /private/var symlink differences by realpath-ing
  const cwd = safeRealpath(process.cwd());
  const lockAbs0 = path.isAbsolute(lockArg) ? lockArg : path.resolve(cwd, lockArg);
  const lockAbs = safeRealpath(lockAbs0);
  // Prefer extracting importer from absolute path segments under apps/* or libs/*
  const m = lockAbs.match(/(?:^|\/)(apps|libs)\/([^\/]+)\/pnpm-lock\.yaml$/);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }
  const rel = path.relative(cwd, lockAbs).split(path.sep).join("/");
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
  // Normalize and guard against escaping outside repo root
  const norm = path.posix.normalize(dir);
  if (norm.startsWith("../")) {
    // Fallback: if symlinks still confused the relative, derive from lockAbs under cwd
    const maybe = lockAbs.startsWith(cwd + "/") ? lockAbs.slice(cwd.length + 1) : lockAbs;
    const mdir = maybe.includes("/") ? maybe.slice(0, maybe.lastIndexOf("/")) : ".";
    return mdir;
  }
  return norm || ".";
}

export function pnpmStoreAttrFromImporter(importer: string): string {
  // Flake exposes pnpm-store.<sanitized> aligned with templates-common.nix sanitizeName
  const normImp = normalizeImporter(importer);
  if (!normImp || normImp === ".") return "pnpm-store.default";
  const sanitized = sanitizeName(normImp);
  return `pnpm-store.${sanitized}`;
}

export function pnpmStoreUnfixedAttrFromImporter(importer: string): string {
  const normImp = normalizeImporter(importer);
  if (!normImp || normImp === ".") return "pnpm-store-unfixed.default";
  const sanitized = sanitizeName(normImp);
  return `pnpm-store-unfixed.${sanitized}`;
}

export function repoRelativeLockfilePath(repoRoot: string, lockfileArg?: string): string {
  // Normalize lockfile to be repo-root relative to avoid absolute importer names
  const lf = lockfileArg ? lockfileArg : "pnpm-lock.yaml";
  // Use realpath to normalize /var vs /private/var
  const abs0 = path.isAbsolute(lf) ? lf : path.resolve(repoRoot, lf);
  const abs = safeRealpath(abs0);
  const rootReal = safeRealpath(repoRoot);
  return path.relative(rootReal, abs).split(path.sep).join("/");
}
