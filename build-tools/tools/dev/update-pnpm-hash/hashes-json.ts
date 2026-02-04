import * as fsp from "node:fs/promises";
import path from "node:path";

export async function updateNodeModulesHashesJson(lockfileRel: string, newHash: string) {
  const file = path.join(process.cwd(), "build-tools", "tools", "nix", "node-modules.hashes.json");
  let obj: Record<string, string> = {};
  try {
    obj = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, string>;
  } catch {}
  obj[lockfileRel] = newHash;
  await fsp.writeFile(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
