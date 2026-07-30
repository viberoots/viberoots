import * as fsp from "node:fs/promises";
import path from "node:path";

export const maxCargoArchiveMembers = 100_000;
const maxExtractedBytes = 2 * 1024 * 1024 * 1024;

export async function cargoRegistrySourceFiles(
  root: string,
  relative = "",
  budget = { entries: 0, bytes: 0 },
): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${item.name}` : item.name;
    budget.entries += 1;
    if (budget.entries > maxCargoArchiveMembers) {
      throw new Error(`Cargo registry source exceeds ${maxCargoArchiveMembers} entries`);
    }
    if (item.isSymbolicLink())
      throw new Error(`Cargo registry source contains a symlink: ${child}`);
    if (item.isDirectory()) files.push(...(await cargoRegistrySourceFiles(root, child, budget)));
    else if (item.isFile()) {
      budget.bytes += (await fsp.stat(path.join(root, child))).size;
      if (budget.bytes > maxExtractedBytes) {
        throw new Error(`Cargo registry source exceeds ${maxExtractedBytes} extracted bytes`);
      }
      files.push(child);
    } else throw new Error(`Cargo registry source contains a non-regular file: ${child}`);
  }
  return files;
}
