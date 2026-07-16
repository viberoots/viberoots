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

export async function readProjectFile(file: string, scanner: string): Promise<string> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (error) {
    throw new Error(`${scanner} cannot read file ${file}`, { cause: error });
  }
}

export async function listProjectFiles(
  root: string,
  predicate: (filePath: string) => boolean,
  opts: { optionalRoot?: boolean } = {},
): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (
        opts.optionalRoot &&
        current === root &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw new Error(`project file tree cannot read directory ${current}`, { cause: error });
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) stack.push(abs);
      else if (entry.isFile() && predicate(abs)) files.push(abs);
    }
  }
  return files.sort();
}
