import * as fsp from "node:fs/promises";
import path from "node:path";
import { ownerPidForIsolation } from "./buck-watchdog-lib.ts";

export function shouldRemoveDeadDevBuildIsolationDir(
  name: string,
  isPidAlive: (pid: number) => boolean,
): boolean {
  const iso = String(name || "").trim();
  if (!iso.startsWith("devbuild-")) return false;
  if (iso.startsWith("devbuild-shared-")) return false;

  const ownerPid = ownerPidForIsolation(iso);
  if (ownerPid === null) return false;
  return !isPidAlive(ownerPid);
}

export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function pruneDeadDevBuildIsolationDirs(
  repoRoot: string,
  isPidAlive: (pid: number) => boolean = defaultIsPidAlive,
): Promise<string[]> {
  const buckOutDir = path.join(repoRoot, "buck-out");
  let names: string[] = [];
  try {
    names = await fsp.readdir(buckOutDir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const name of names) {
    if (!shouldRemoveDeadDevBuildIsolationDir(name, isPidAlive)) continue;
    try {
      await fsp.rm(path.join(buckOutDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {}
  }
  return removed;
}
