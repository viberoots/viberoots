import path from "node:path";
import fs from "node:fs";
import { nodeFlagsWithZx } from "../../lib/node-run";
import { resolveWorkspaceRootSync } from "../../lib/repo";

export function repoRoot(): string {
  return resolveWorkspaceRootSync();
}

export function nodeBin(): string {
  return process.execPath || "node";
}

export function buildToolsRoot(root: string): string {
  const current = path.resolve(root, ".viberoots/current/build-tools");
  if (fs.existsSync(path.join(current, "tools", "dev", "zx-init.mjs"))) return current;
  const extracted = path.resolve(root, "viberoots", "build-tools");
  if (fs.existsSync(path.join(extracted, "tools", "dev", "zx-init.mjs"))) return extracted;
  return path.resolve(root, "build-tools");
}

export function buildToolPath(root: string, rel: string): string {
  return path.join(buildToolsRoot(root), rel);
}

export function zxInitPath(root: string): string {
  return buildToolPath(root, "tools/dev/zx-init.mjs");
}

export function zxNodeBase(root: string): string {
  return nodeFlagsWithZx(zxInitPath(root)).join(" ");
}
