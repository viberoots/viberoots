import type { Dirent } from "node:fs";

import * as fsp from "node:fs/promises";
import path from "node:path";

const FORMAT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".css",
  ".html",
]);

async function collectFormattableFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === "pnpm-lock.yaml") continue;
      if (!FORMAT_EXTENSIONS.has(path.extname(entry.name))) continue;
      out.push(path.resolve(abs));
    }
  }
  await walk(root);
  return out.sort();
}

export async function formatScaffoldOutput(dest: string): Promise<void> {
  const files = await collectFormattableFiles(dest);
  if (files.length === 0) return;
  await $({
    cwd: process.cwd(),
    stdio: "pipe",
  })`prettier --write ${files}`;
}

export async function refreshImporterStoreHash(repoRoot: string, importer: string): Promise<void> {
  const lockfile = path.join(importer, "pnpm-lock.yaml");
  const absLockfile = path.join(repoRoot, lockfile);
  const hasLockfile = await fsp
    .stat(absLockfile)
    .then((s) => s.isFile())
    .catch(() => false);
  if (!hasLockfile) return;
  await $({
    cwd: repoRoot,
    stdio: "inherit",
  })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
}

export async function formatImporterLockfiles(
  repoRoot: string,
  importers: string[],
): Promise<void> {
  const lockfiles: string[] = [];
  for (const importer of importers) {
    const absLockfile = path.join(repoRoot, importer, "pnpm-lock.yaml");
    const hasLockfile = await fsp
      .stat(absLockfile)
      .then((s) => s.isFile())
      .catch(() => false);
    if (hasLockfile) lockfiles.push(absLockfile);
  }
  if (lockfiles.length === 0) return;
  await $({
    cwd: repoRoot,
    stdio: "pipe",
  })`prettier --write ${lockfiles}`;
}

export function templateImportersToRefresh(opts: {
  template: string;
  name: string;
  destRoot: string;
  primaryImporter: string;
}): string[] {
  const out = new Set<string>();
  out.add(opts.primaryImporter);
  if (opts.template === "wasm-linking-app") {
    out.add(path.join(opts.destRoot, "apps", opts.name));
    out.add(path.join(opts.destRoot, "apps", `${opts.name}-cli`));
    out.add(path.join(opts.destRoot, "libs", `${opts.name}-wasm-inline`));
  }
  return Array.from(out);
}
