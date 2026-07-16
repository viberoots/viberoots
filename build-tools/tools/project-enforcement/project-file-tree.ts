import * as fsp from "node:fs/promises";
import path from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".direnv",
  ".git",
  ".terraform",
  "buck-out",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export async function listProjectFiles(
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) stack.push(abs);
      else if (entry.isFile() && predicate(abs)) files.push(abs);
    }
  }
  return files.sort();
}
