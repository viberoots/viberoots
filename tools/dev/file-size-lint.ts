#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

type Options = {
  changedOnly: boolean;
  threshold: number;
};

function parseArgs(argv: any): Options {
  const changedOnly = argv["changed-only"] === true || argv.changedOnly === true;
  const threshold = Number(argv.threshold || 250);
  return { changedOnly, threshold };
}

async function listTrackedFiles(): Promise<string[]> {
  try {
    const { stdout } = await $`git ls-files -z`;
    return String(stdout || "")
      .split("\0")
      .filter(Boolean);
  } catch {
    // Fallback to a conservative crawl
    const result: string[] = [];
    const root = process.cwd();
    const ignore = new Set([
      ".git",
      "buck-out",
      "node_modules",
      "coverage",
      ".clinic",
      ".direnv",
      "result",
    ]);
    async function walk(dir: string) {
      let entries: any[] = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name));
        if (e.isDirectory()) {
          if (ignore.has(e.name)) continue;
          await walk(path.join(dir, e.name));
        } else {
          result.push(rel);
        }
      }
    }
    await walk(root);
    return result;
  }
}

async function listChangedFiles(): Promise<string[]> {
  // Best-effort: try staged/untracked against HEAD; fall back to tracked
  try {
    const { stdout } = await $`git diff --name-only --diff-filter=AMR HEAD -z`;
    const changed = String(stdout || "")
      .split("\0")
      .filter(Boolean);
    if (changed.length > 0) return changed;
  } catch {}
  return listTrackedFiles();
}

async function countLines(file: string): Promise<number> {
  try {
    const data = await fsp.readFile(file, "utf8");
    // Normalize Windows newlines as well
    return data.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

async function main() {
  const { changedOnly, threshold } = parseArgs((global as any).argv);
  const files = changedOnly ? await listChangedFiles() : await listTrackedFiles();
  const warnExts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".bzl", ".nix"]);
  const offenders: Array<{ file: string; lines: number }> = [];
  for (const f of files) {
    const ext = path.extname(f);
    if (!warnExts.has(ext)) continue;
    const lines = await countLines(f);
    if (lines > threshold) offenders.push({ file: f, lines });
  }
  if (offenders.length > 0) {
    console.warn(`file-size-lint: ${offenders.length} file(s) exceed ${threshold} LOC (warn-only)`);
    for (const { file, lines } of offenders.sort((a, b) => b.lines - a.lines)) {
      console.warn(`  ${file}: ${lines} lines`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(0);
});
