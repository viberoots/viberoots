import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildToolPath } from "../dev-build/paths";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hashesJsonPaths(): string[] {
  const root = process.cwd();
  return unique([
    buildToolPath(root, "tools/nix/node-modules.hashes.json"),
    path.join(root, "build-tools", "tools", "nix", "node-modules.hashes.json"),
    path.join(root, "viberoots", "build-tools", "tools", "nix", "node-modules.hashes.json"),
    path.join(
      root,
      ".viberoots",
      "current",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    ),
  ]);
}

async function readHashesJson(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const candidate of hashesJsonPaths()) {
    try {
      Object.assign(merged, JSON.parse(await fsp.readFile(candidate, "utf8")));
    } catch {}
  }
  return merged;
}

async function writeHashesJson(obj: Record<string, string>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify(sorted, null, 2) + "\n";
  for (const candidate of hashesJsonPaths()) {
    try {
      await fsp.mkdir(path.dirname(candidate), { recursive: true });
      await fsp.writeFile(candidate, payload, "utf8");
    } catch {}
  }
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
