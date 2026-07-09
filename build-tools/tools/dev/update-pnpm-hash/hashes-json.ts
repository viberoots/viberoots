import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { buildToolPath } from "../dev-build/paths";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function workspaceHashesJsonPath(root: string): string {
  return path.join(root, "projects", "node-modules.hashes.json");
}

function isStandaloneViberootsSource(root: string): boolean {
  const rootTool = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  return (
    path.basename(root) !== "workspace" &&
    !root.endsWith(path.join(".viberoots", "workspace")) &&
    !root.includes(`${path.sep}.viberoots${path.sep}workspace`) &&
    fs.existsSync(rootTool) &&
    path.resolve(buildToolPath(root, "tools/dev/zx-init.mjs")) === path.resolve(rootTool)
  );
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

function writableViberootsHashesJsonPath(root: string): string | null {
  if (isStandaloneViberootsSource(root)) return viberootsHashesJsonPaths(root)[0];
  const extractedTool = path.join(root, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs");
  if (fs.existsSync(extractedTool)) {
    return path.join(root, "viberoots", "build-tools", "tools", "nix", "node-modules.hashes.json");
  }
  return null;
}

function hashesJsonPaths(root = process.cwd()): string[] {
  return unique([...viberootsHashesJsonPaths(root), workspaceHashesJsonPath(root)]);
}

function writableHashesJsonPaths(root = process.cwd()): string[] {
  const writable = [workspaceHashesJsonPath(root)];
  if (isStandaloneViberootsSource(root)) {
    writable.unshift(viberootsHashesJsonPaths(root)[0]);
  }
  return unique(writable);
}

export type HashesJsonOwner = "workspace" | "viberoots";
export type HashesJsonOptions = { owner?: HashesJsonOwner; root?: string };

function ownerHashesJsonPath(
  lockfileRel: string,
  owner?: HashesJsonOwner,
  root = process.cwd(),
): string {
  if (owner === "viberoots")
    return writableViberootsHashesJsonPath(root) || workspaceHashesJsonPath(root);
  if (owner === "workspace") return workspaceHashesJsonPath(root);
  return lockfileRel.startsWith("projects/") || !isStandaloneViberootsSource(root)
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

async function readHashesJson(root = process.cwd()): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const candidate of hashesJsonPaths(root)) {
    Object.assign(merged, await readJsonFile(candidate));
  }
  return merged;
}

async function readOwnerHashesJson(
  owner: HashesJsonOwner,
  root = process.cwd(),
): Promise<Record<string, string>> {
  const candidates =
    owner === "viberoots"
      ? unique([
          ...viberootsHashesJsonPaths(root),
          ownerHashesJsonPath("pnpm-lock.yaml", owner, root),
        ])
      : [workspaceHashesJsonPath(root)];
  const merged: Record<string, string> = {};
  for (const candidate of candidates) {
    Object.assign(merged, await readJsonFile(candidate));
  }
  return merged;
}

async function removeHashFromNonOwnerFiles(
  lockfileRel: string,
  owner: string,
  root = process.cwd(),
): Promise<void> {
  const ownerReal = await fsp.realpath(owner).catch(() => path.resolve(owner));
  for (const candidate of writableHashesJsonPaths(root)) {
    if (candidate === owner) continue;
    const candidateReal = await fsp.realpath(candidate).catch(() => path.resolve(candidate));
    if (candidateReal === ownerReal) continue;
    const obj = await readJsonFile(candidate);
    if (!(lockfileRel in obj)) continue;
    delete obj[lockfileRel];
    await writeJsonFile(candidate, obj).catch(() => {});
  }
}

export async function updateNodeModulesHashesJson(
  lockfileRel: string,
  newHash: string,
  opts: HashesJsonOptions = {},
) {
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  const owner = ownerHashesJsonPath(lockfileRel, opts.owner, root);
  const obj = await readJsonFile(owner);
  obj[lockfileRel] = newHash;
  await writeJsonFile(owner, obj);
  if (opts.owner !== "viberoots") {
    await removeHashFromNonOwnerFiles(lockfileRel, owner, root);
  }
}

export async function pruneNodeModulesHashesJson(
  keepLockfiles: string[],
  opts: { root?: string } = {},
): Promise<string[]> {
  const keep = new Set(keepLockfiles);
  const removed: string[] = [];
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  for (const candidate of writableHashesJsonPaths(root)) {
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

export async function readNodeModulesHashForLockfile(
  lockfileRel: string,
  opts: HashesJsonOptions = {},
): Promise<string> {
  try {
    const root = opts.root ? path.resolve(opts.root) : process.cwd();
    const obj = opts.owner
      ? await readOwnerHashesJson(opts.owner, root)
      : await readHashesJson(root);
    const v = String(obj[lockfileRel] || "").trim();
    return v;
  } catch {
    return "";
  }
}
