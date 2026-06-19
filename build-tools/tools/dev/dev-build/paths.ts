import path from "node:path";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { nodeFlagsWithZx } from "../../lib/node-run";

export function repoRoot(): string {
  // Resolve from git so commands work when invoked from subdirectories.
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .trim()
      .replace(/\r?\n/g, "");
    if (out) return out;
  } catch {
    // Fall through to non-git fallback.
  }
  try {
    return process.cwd();
  } catch {}
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..", "..");
}

export function nodeBin(): string {
  return process.execPath || "node";
}

export function buildToolsRoot(root: string): string {
  const extracted = path.resolve(root, "viberoots", "build-tools");
  if (fs.existsSync(path.join(extracted, "tools", "dev", "zx-init.mjs"))) return extracted;
  const current = path.resolve(root, ".viberoots/current/build-tools");
  if (fs.existsSync(path.join(current, "tools", "dev", "zx-init.mjs"))) return current;
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
