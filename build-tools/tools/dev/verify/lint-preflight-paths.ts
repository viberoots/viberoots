import path from "node:path";
import * as fsp from "node:fs/promises";

function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

async function collectFiles(root: string, relDir: string, out: string[]): Promise<void> {
  const entries = await fsp
    .readdir(path.join(root, relDir), { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "buck-out") {
      continue;
    }
    const rel = normalizeRepoPath(path.posix.join(relDir, entry.name));
    if (entry.isDirectory()) {
      await collectFiles(root, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

export async function filterExistingLintPreflightPaths(
  root: string,
  relPaths: string[],
): Promise<string[]> {
  const existing: string[] = [];
  for (const relPath of relPaths) {
    try {
      const stat = await fsp.stat(path.join(root, relPath));
      if (stat.isFile()) existing.push(relPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }
  return existing;
}

export async function resolveLintPreflightFilterPaths(
  root: string,
  relPaths: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const rawPath of relPaths) {
    const relPath = normalizeRepoPath(rawPath);
    if (!relPath) continue;
    if (relPath === ".") {
      out.push(".");
      continue;
    }
    try {
      const stat = await fsp.stat(path.join(root, relPath));
      if (stat.isFile()) {
        out.push(relPath);
      } else if (stat.isDirectory()) {
        await collectFiles(root, relPath, out);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }
  return Array.from(new Set(out)).sort();
}
