import path from "node:path";
import { execSync } from "node:child_process";
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

export function zxNodeBase(root: string): string {
  const zxInit = path.resolve(root, "build-tools/tools/dev/zx-init.mjs");
  return nodeFlagsWithZx(zxInit).join(" ");
}
