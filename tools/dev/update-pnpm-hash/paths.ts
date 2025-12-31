import fs from "node:fs";
import path from "node:path";
import { sanitizeName } from "../install/common.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";

export function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // If the path doesn't exist yet (e.g., transient in temp), normalize segments instead
    return path.resolve(p);
  }
}

export function normalizeImporter(imp: string): string {
  const raw = String(imp || "").trim();
  if (!raw) return ".";
  const { workspaceRoots } = getImporterRootsContract();
  const isSegment = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);

  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2 && workspaceRoots.includes(parts[0]) && isSegment(parts[1])) {
    return `${parts[0]}/${parts[1]}`;
  }
  for (let i = 0; i + 1 < parts.length; i++) {
    const root = parts[i];
    const name = parts[i + 1];
    if (workspaceRoots.includes(root) && isSegment(name)) return `${root}/${name}`;
  }
  return ".";
}

export function importerFromLockfile(lockArg: string): string {
  // Resolve potential macOS /var vs /private/var symlink differences by realpath-ing
  const cwd = safeRealpath(process.cwd());
  const lockAbs0 = path.isAbsolute(lockArg) ? lockArg : path.resolve(cwd, lockArg);
  const lockAbs = safeRealpath(lockAbs0);
  const rel = path.relative(cwd, lockAbs).split(path.sep).join("/");
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
  // Normalize and guard against escaping outside repo root
  const norm = path.posix.normalize(dir);
  if (norm.startsWith("../")) {
    // Fallback: if symlinks still confused the relative, derive from lockAbs under cwd
    const maybe = lockAbs.startsWith(cwd + "/") ? lockAbs.slice(cwd.length + 1) : lockAbs;
    const mdir = maybe.includes("/") ? maybe.slice(0, maybe.lastIndexOf("/")) : ".";
    return normalizeImporter(mdir);
  }
  return normalizeImporter(norm || ".");
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
