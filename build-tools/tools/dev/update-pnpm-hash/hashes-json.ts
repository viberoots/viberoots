import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildToolPath } from "../dev-build/paths";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function workspaceHashesJsonPath(root: string): string {
  return path.join(root, "projects", "node-modules.hashes.json");
}

function viberootsHashesJsonPaths(root: string): string[] {
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

function hashesJsonPaths(): string[] {
  const root = process.cwd();
  return unique([...viberootsHashesJsonPaths(root), workspaceHashesJsonPath(root)]);
}

function ownerHashesJsonPath(lockfileRel: string): string {
  const root = process.cwd();
  return lockfileRel.startsWith("projects/")
    ? workspaceHashesJsonPath(root)
    : viberootsHashesJsonPaths(root)[0];
}

async function readJsonFile(candidate: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(candidate, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeJsonFile(candidate: string, obj: Record<string, string>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify(sorted, null, 2) + "\n";
  await fsp.mkdir(path.dirname(candidate), { recursive: true });
  await fsp.writeFile(candidate, payload, "utf8");
}

async function readHashesJson(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const candidate of hashesJsonPaths()) {
    Object.assign(merged, await readJsonFile(candidate));
  }
  return merged;
}

async function removeHashFromNonOwnerFiles(lockfileRel: string, owner: string): Promise<void> {
  const ownerReal = await fsp.realpath(owner).catch(() => path.resolve(owner));
  for (const candidate of hashesJsonPaths()) {
    if (candidate === owner) continue;
    const candidateReal = await fsp.realpath(candidate).catch(() => path.resolve(candidate));
    if (candidateReal === ownerReal) continue;
    const obj = await readJsonFile(candidate);
    if (!(lockfileRel in obj)) continue;
    delete obj[lockfileRel];
    await writeJsonFile(candidate, obj).catch(() => {});
  }
}

export async function updateNodeModulesHashesJson(lockfileRel: string, newHash: string) {
  const owner = ownerHashesJsonPath(lockfileRel);
  const obj = await readJsonFile(owner);
  obj[lockfileRel] = newHash;
  await writeJsonFile(owner, obj);
  await removeHashFromNonOwnerFiles(lockfileRel, owner);
}

export async function pruneNodeModulesHashesJson(keepLockfiles: string[]): Promise<string[]> {
  const keep = new Set(keepLockfiles);
  const removed: string[] = [];
  for (const candidate of hashesJsonPaths()) {
    const obj = await readJsonFile(candidate);
    let changed = false;
    for (const key of Object.keys(obj)) {
      if (keep.has(key)) continue;
      removed.push(key);
      delete obj[key];
      changed = true;
    }
    if (changed) {
      await writeJsonFile(candidate, obj).catch(() => {});
    }
  }
  return unique(removed).sort();
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
