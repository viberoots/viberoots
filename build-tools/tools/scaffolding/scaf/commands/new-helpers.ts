import type { Dirent } from "node:fs";

import * as fsp from "node:fs/promises";
import path from "node:path";
import { runScafCommand } from "../command-runner";

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

const FORMAT_EXCLUDED_DIRS = new Set([
  ".cache",
  ".direnv",
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "buck-out",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function shouldSkipFormatDir(name: string): boolean {
  return (
    FORMAT_EXCLUDED_DIRS.has(name) ||
    name === ".wasm-producer" ||
    name === "result" ||
    name.startsWith("result-")
  );
}

async function collectFormattableFiles(root: string): Promise<string[]> {
  const out = new Set<string>();

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
        if (shouldSkipFormatDir(entry.name)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === "pnpm-lock.yaml") continue;
      if (!FORMAT_EXTENSIONS.has(path.extname(entry.name))) continue;
      out.add(path.resolve(abs));
    }
  }

  async function visit(target: string) {
    let stat: Dirent | null = null;
    try {
      const abs = path.resolve(target);
      const fileStat = await fsp.stat(abs);
      if (fileStat.isDirectory()) {
        await walk(abs);
        return;
      }
      if (!fileStat.isFile()) return;
      const name = path.basename(abs);
      if (name === "pnpm-lock.yaml") return;
      if (!FORMAT_EXTENSIONS.has(path.extname(name))) return;
      out.add(abs);
      return;
    } catch {
      stat = null;
    }
    void stat;
  }

  await visit(root);
  return Array.from(out).sort();
}

export async function formatScaffoldPaths(paths: string[]): Promise<void> {
  const unique = Array.from(
    new Set(paths.map((value) => path.resolve(value)).filter((value) => value.length > 0)),
  );
  const files = (
    await Promise.all(unique.map(async (target) => await collectFormattableFiles(target)))
  )
    .flat()
    .sort();
  const deduped = Array.from(new Set(files));
  if (deduped.length === 0) return;
  const chunkSize = 128;
  for (let idx = 0; idx < deduped.length; idx += chunkSize) {
    const chunk = deduped.slice(idx, idx + chunkSize);
    await runScafCommand("prettier", ["--write", ...chunk], process.cwd());
  }
}

export async function formatScaffoldOutput(dest: string): Promise<void> {
  await formatScaffoldPaths([dest]);
}

export async function removeScaffoldTemplateConfig(dest: string): Promise<void> {
  await Promise.all([
    fsp.rm(path.join(dest, "copier.yaml"), { force: true }),
    fsp.rm(path.join(dest, "copier.yml"), { force: true }),
  ]);
}

export async function refreshImporterStoreHash(repoRoot: string, importer: string): Promise<void> {
  const lockfile = path.join(importer, "pnpm-lock.yaml");
  const absLockfile = path.join(repoRoot, lockfile);
  const hasLockfile = await fsp
    .stat(absLockfile)
    .then((s) => s.isFile())
    .catch(() => false);
  if (!hasLockfile) return;
  await runScafCommand(
    "zx-wrapper",
    ["build-tools/tools/dev/update-pnpm-hash.ts", "--lockfile", lockfile],
    repoRoot,
  );
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
  await runScafCommand("prettier", ["--write", ...lockfiles], repoRoot);
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
