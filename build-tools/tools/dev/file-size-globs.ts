import path from "node:path";
import * as fsp from "node:fs/promises";
import { normalizeRepoPath } from "../lib/repo-path";

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globRegex(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.slice(i, i + 3) === "**/") {
      source += "(?:.*/)?";
      i += 2;
    } else if (glob.slice(i, i + 2) === "**") {
      source += ".*";
      i += 1;
    } else if (glob[i] === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegex(glob[i] || "");
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globRegex(pattern).test(relPath));
}

export async function listFilesMatching(opts: {
  root: string;
  include: readonly string[];
  exclude: readonly string[];
  optionalRoot?: boolean;
}): Promise<string[]> {
  const result: string[] = [];
  const ignoredDirs = new Set([".git", ".direnv", "buck-out", "node_modules", "coverage"]);

  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (
        opts.optionalRoot &&
        dir === opts.root &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw new Error(`file-size scanner cannot read directory ${dir}`, { cause: error });
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const rel = normalizeRepoPath(path.relative(opts.root, abs));
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name) || matchesAny(`${rel}/`, opts.exclude)) continue;
        await walk(abs);
      } else if (matchesAny(rel, opts.include) && !matchesAny(rel, opts.exclude)) {
        result.push(rel);
      }
    }
  }

  await walk(opts.root);
  return result.sort();
}
