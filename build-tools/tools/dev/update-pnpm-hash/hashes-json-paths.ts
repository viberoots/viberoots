import fs from "node:fs";
import path from "node:path";
import { buildToolPath } from "../dev-build/paths";

export type HashesJsonOwner = "workspace" | "viberoots";
export type HashesJsonOptions = { owner?: HashesJsonOwner; root?: string };

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function workspaceHashesJsonPath(root: string): string {
  return path.join(root, "projects", "config", "node-modules.hashes.json");
}

function canonicalPath(candidate: string): string {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

export function isStandaloneViberootsSource(root: string): boolean {
  const rootTool = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  return (
    path.basename(root) !== "workspace" &&
    !root.endsWith(path.join(".viberoots", "workspace")) &&
    !root.includes(`${path.sep}.viberoots${path.sep}workspace`) &&
    fs.existsSync(rootTool) &&
    canonicalPath(buildToolPath(root, "tools/dev/zx-init.mjs")) === canonicalPath(rootTool)
  );
}

export function viberootsHashesJsonPaths(root: string): string[] {
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

export function writableViberootsHashesJsonPath(root: string): string | null {
  if (isStandaloneViberootsSource(root)) return viberootsHashesJsonPaths(root)[0];
  const extractedTool = path.join(root, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs");
  if (fs.existsSync(extractedTool)) {
    return path.join(root, "viberoots", "build-tools", "tools", "nix", "node-modules.hashes.json");
  }
  return null;
}

export function hashesJsonPaths(root = process.cwd()): string[] {
  return unique([...viberootsHashesJsonPaths(root), workspaceHashesJsonPath(root)]);
}

export function writableHashesJsonPaths(root = process.cwd()): string[] {
  const writable = [workspaceHashesJsonPath(root)];
  if (isStandaloneViberootsSource(root)) {
    writable.unshift(viberootsHashesJsonPaths(root)[0]);
  }
  return unique(writable);
}

export function hashOwnerForLockfile(
  lockfileRel: string,
  root = process.cwd(),
  importer = "",
): HashesJsonOwner {
  if (importer === "viberoots") return "viberoots";
  return lockfileRel.startsWith("projects/") || !isStandaloneViberootsSource(root)
    ? "workspace"
    : "viberoots";
}

export function ownerHashesJsonPath(
  lockfileRel: string,
  owner?: HashesJsonOwner,
  root = process.cwd(),
): string {
  if (owner === "viberoots")
    return writableViberootsHashesJsonPath(root) || workspaceHashesJsonPath(root);
  if (owner === "workspace") return workspaceHashesJsonPath(root);
  return hashOwnerForLockfile(lockfileRel, root) === "workspace"
    ? workspaceHashesJsonPath(root)
    : viberootsHashesJsonPaths(root)[0];
}
