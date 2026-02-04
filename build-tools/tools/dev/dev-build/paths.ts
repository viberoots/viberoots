import path from "node:path";
import { nodeFlagsWithZx } from "../../lib/node-run.ts";

export function repoRoot(): string {
  // Prefer the current working directory so tests running in a temp repo operate on that sandbox.
  // Fall back to script-relative resolution if CWD is unavailable.
  try {
    return process.cwd();
  } catch {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, "..", "..", "..", "..");
  }
}

export function nodeBin(): string {
  return process.execPath || "node";
}

export function zxNodeBase(root: string): string {
  const zxInit = path.resolve(root, "build-tools/tools/dev/zx-init.mjs");
  return nodeFlagsWithZx(zxInit).join(" ");
}
