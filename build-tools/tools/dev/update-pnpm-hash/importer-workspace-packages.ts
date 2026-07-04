import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packageJsonWorkspaceDeps } from "./workspace-deps";

async function findWorkspacePackageDirsRelativeTo(opts: {
  repoRoot: string;
  importerAbs: string;
  relativeTo: string;
}): Promise<string[]> {
  const pkgPath = path.join(opts.importerAbs, "package.json");
  let wanted: string[] = [];
  try {
    wanted = packageJsonWorkspaceDeps(JSON.parse(await fsp.readFile(pkgPath, "utf8")));
  } catch {
    return [];
  }
  if (wanted.length === 0) return [];
  const remaining = new Set(wanted);
  const found: string[] = [];
  const skipDirs = new Set([
    ".cache",
    ".direnv",
    ".git",
    ".next",
    ".pnpm-store",
    ".turbo",
    ".vite",
    "buck-out",
    "coverage",
    "dist",
    "node_modules",
    "result",
  ]);

  async function walk(dir: string): Promise<void> {
    if (remaining.size === 0) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (remaining.size === 0) return;
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name) || entry.name.startsWith("result-")) continue;
      const child = path.join(dir, entry.name);
      const childPkgPath = path.join(child, "package.json");
      try {
        const childPkg = JSON.parse(await fsp.readFile(childPkgPath, "utf8"));
        const childName = String(childPkg?.name || "").trim();
        if (remaining.delete(childName)) found.push(path.relative(opts.relativeTo, child) || ".");
      } catch {}
      await walk(child);
    }
  }

  await walk(opts.repoRoot);
  return found.map((value) => value.split(path.sep).join(path.posix.sep)).sort();
}

export async function findWorkspacePackageDirs(opts: {
  repoRoot: string;
  importerAbs: string;
}): Promise<string[]> {
  return await findWorkspacePackageDirsRelativeTo({
    ...opts,
    relativeTo: opts.importerAbs,
  });
}

export async function findWorkspacePackageRepoDirs(opts: {
  repoRoot: string;
  importerAbs: string;
}): Promise<string[]> {
  return await findWorkspacePackageDirsRelativeTo({
    ...opts,
    relativeTo: opts.repoRoot,
  });
}
