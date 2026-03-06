import * as fsp from "node:fs/promises";
import path from "node:path";

function hashesJsonPath(): string {
  return path.join(process.cwd(), "build-tools", "tools", "nix", "node-modules.hashes.json");
}

async function readHashesJson(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(hashesJsonPath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeHashesJson(obj: Record<string, string>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  await fsp.writeFile(hashesJsonPath(), JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

export async function updateNodeModulesHashesJson(lockfileRel: string, newHash: string) {
  const obj = await readHashesJson();
  obj[lockfileRel] = newHash;
  await writeHashesJson(obj);
}

export async function pruneNodeModulesHashesJson(keepLockfiles: string[]): Promise<string[]> {
  const obj = await readHashesJson();
  const keep = new Set(keepLockfiles);
  const removed: string[] = [];
  for (const key of Object.keys(obj)) {
    if (keep.has(key)) continue;
    removed.push(key);
    delete obj[key];
  }
  if (removed.length > 0) {
    await writeHashesJson(obj);
  }
  return removed.sort();
}

export async function readNodeModulesHashForLockfile(lockfileRel: string): Promise<string> {
  try {
    const obj = await readHashesJson();
    const v = String(obj[lockfileRel] || "").trim();
    return v;
  } catch {
    return "";
  }
}
