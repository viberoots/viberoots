import path from "node:path";
import * as fsp from "node:fs/promises";

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
