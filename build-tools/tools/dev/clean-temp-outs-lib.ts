import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveToolPathSync } from "../lib/tool-paths";
import { ownerPidForIsolation } from "./buck-watchdog-lib.ts";

export function shouldRemoveDeadOwnedBuckIsolationDir(
  name: string,
  isPidAlive: (pid: number) => boolean,
): boolean {
  const iso = String(name || "").trim();
  if (iso.startsWith("devbuild-shared-")) return false;
  if (iso.startsWith("exporter-shared-")) return false;

  const ownerPid = ownerPidForIsolation(iso);
  if (ownerPid === null) return false;
  return !isPidAlive(ownerPid);
}

export function shouldRemoveDeadDevBuildIsolationDir(
  name: string,
  isPidAlive: (pid: number) => boolean,
): boolean {
  const iso = String(name || "").trim();
  if (!iso.startsWith("devbuild-")) return false;
  return shouldRemoveDeadOwnedBuckIsolationDir(iso, isPidAlive);
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

async function liveBuckIsolationDirs(): Promise<ReadonlySet<string>> {
  const psPath = resolveToolPathSync("ps");
  return await new Promise<ReadonlySet<string>>((resolve) => {
    const child = spawn(psPath, ["-axo", "command="], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
    });
    child.on("error", () => resolve(new Set()));
    child.on("close", () => {
      const live = new Set<string>();
      for (const line of String(buf || "").split(/\r?\n/)) {
        if (!line.includes("buck2d[") || !line.includes("--isolation-dir")) continue;
        const match = line.match(/--isolation-dir\s+([^\s]+)/);
        const iso = match?.[1] ? String(match[1]).trim() : "";
        if (iso) live.add(iso);
      }
      resolve(live);
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(new Set());
    }, 2_000);
    child.on("close", () => clearTimeout(timer));
  });
}

export async function pruneDeadOwnedBuckIsolationDirs(
  repoRoot: string,
  isPidAlive: (pid: number) => boolean = defaultIsPidAlive,
  liveIsolations?: ReadonlySet<string>,
): Promise<string[]> {
  const buckOutDir = path.join(repoRoot, "buck-out");
  let names: string[] = [];
  try {
    names = await fsp.readdir(buckOutDir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  const live = liveIsolations ?? (await liveBuckIsolationDirs());
  for (const name of names) {
    if (!shouldRemoveDeadOwnedBuckIsolationDir(name, isPidAlive)) continue;
    if (live.has(name)) continue;
    try {
      await fsp.rm(path.join(buckOutDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch {}
  }
  return removed;
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
