import * as fsp from "node:fs/promises";
import path from "node:path";

export async function directorySnapshot(root: string, rel = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fsp.readdir(path.join(root, rel), { withFileTypes: true })) {
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await directorySnapshot(root, childRel));
    } else if (entry.isSymbolicLink()) {
      result[childRel] = `link:${await fsp.readlink(path.join(root, childRel))}`;
    } else {
      result[childRel] =
        `file:${(await fsp.readFile(path.join(root, childRel))).toString("base64")}`;
    }
  }
  return result;
}
