import * as fsp from "node:fs/promises";
import path from "node:path";

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
      if (entry.isDirectory() && entry.name !== ".terraform") stack.push(abs);
      else if (entry.isFile() && predicate(abs)) files.push(abs);
    }
  }
  return files.sort();
}
