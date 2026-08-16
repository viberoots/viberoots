import fs from "node:fs";
import path from "node:path";

function realpathOrOriginal(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function isTransientCodexArg0Path(dir: string, homeDir = process.env.HOME || ""): boolean {
  if (!dir || !homeDir) return false;
  const home = realpathOrOriginal(homeDir);
  const resolvedDir = realpathOrOriginal(dir);
  const arg0Root = path.join(home, ".codex", "tmp", "arg0");
  return resolvedDir === arg0Root || resolvedDir.startsWith(`${arg0Root}${path.sep}`);
}

export function filterCapturedHostPath(hostPath: string, homeDir = process.env.HOME || ""): string {
  return hostPath
    .split(path.delimiter)
    .filter((dir) => dir && !isTransientCodexArg0Path(dir, homeDir))
    .join(path.delimiter);
}
