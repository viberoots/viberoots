import * as fsp from "node:fs/promises";
import path from "node:path";
import { buckProcessCommandLines, buckProcessTableLines } from "../../lib/process-inspection";

function isDevBuildRootBuckOutEntry(name: string): boolean {
  return name.startsWith("devbuild-") || name.startsWith("exporter-");
}

function isSharedDevBuildRootBuckOutEntry(name: string): boolean {
  return name.startsWith("devbuild-shared-") || name.startsWith("exporter-shared-");
}

async function removeIfEmpty(dir: string): Promise<void> {
  await fsp.rmdir(dir).catch(() => {});
}

async function liveBuckIsolations(): Promise<Set<string>> {
  const live = new Set<string>();
  for (const line of await buckProcessCommandLines(2000).catch(() => [])) {
    const match = line.match(/--isolation-dir\s+([^\s]+)/);
    const iso = String(match?.[1] || "").trim();
    if (iso) live.add(iso);
  }
  return live;
}

function parsePsLine(line: string): { pid: number; ppid: number; cmd: string } | null {
  const match = String(line || "").match(/^(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const ppid = Number(match[2]);
  if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;
  return { pid, ppid, cmd: match[3] || "" };
}

export function duplicateSharedBuckDaemonPidsFromLines(root: string, lines: string[]): number[] {
  const repoRoot = path.resolve(root);
  const daemonIsoByPid = new Map<number, string>();
  const forkGroups = new Map<string, Array<{ pid: number; ppid: number }>>();
  for (const line of lines) {
    const parsed = parsePsLine(line);
    if (!parsed) continue;
    const isoFromArg = String(parsed.cmd.match(/--isolation-dir\s+([^\s]+)/)?.[1] || "").trim();
    if (parsed.cmd.includes("buck2d[") && isSharedDevBuildRootBuckOutEntry(isoFromArg)) {
      daemonIsoByPid.set(parsed.pid, isoFromArg);
    }
    if (!parsed.cmd.includes("(buck2-forkserver)")) continue;
    const stateDir = String(parsed.cmd.match(/--state-dir\s+([^\s]+)/)?.[1] || "").trim();
    const rel = path.relative(path.join(repoRoot, "buck-out"), stateDir);
    const iso = rel.split(path.sep)[0] || isoFromArg;
    if (!stateDir.startsWith(path.join(repoRoot, "buck-out", iso, "forkserver"))) continue;
    if (!isSharedDevBuildRootBuckOutEntry(iso)) continue;
    const existing = forkGroups.get(iso) || [];
    existing.push({ pid: parsed.pid, ppid: parsed.ppid });
    forkGroups.set(iso, existing);
  }

  const pids = new Set<number>();
  for (const [iso, forks] of forkGroups) {
    if (forks.length <= 1) continue;
    for (const fork of forks) {
      pids.add(fork.pid);
      if (daemonIsoByPid.get(fork.ppid) === iso) pids.add(fork.ppid);
    }
  }
  return [...pids].sort((a, b) => a - b);
}

async function cleanupDuplicateSharedBuckDaemons(root: string): Promise<string[]> {
  const lines = await buckProcessTableLines(2000).catch(() => []);
  const pids = duplicateSharedBuckDaemonPidsFromLines(root, lines);
  if (pids.length === 0) return [];
  const isolations = new Set<string>();
  for (const line of lines) {
    const parsed = parsePsLine(line);
    if (!parsed || !pids.includes(parsed.pid)) continue;
    const iso = String(parsed.cmd.match(/--isolation-dir\s+([^\s]+)/)?.[1] || "").trim();
    if (isSharedDevBuildRootBuckOutEntry(iso)) isolations.add(iso);
  }
  for (const iso of isolations) {
    await $({ cwd: root, stdio: "ignore" })`buck2 --isolation-dir ${iso} kill`.nothrow();
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return [...isolations].sort().map((iso) => `duplicate-shared-daemon:${iso}`);
}

export async function cleanupDevBuildRootBuckOut(root: string): Promise<string[]> {
  const buckOut = path.join(root, "buck-out");
  const removed: string[] = await cleanupDuplicateSharedBuckDaemons(root);
  const broadCleanup = process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP === "1";
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(buckOut);
  } catch {
    return [];
  }

  const live = await liveBuckIsolations();
  for (const entry of entries) {
    if (!isDevBuildRootBuckOutEntry(entry)) continue;
    if (entry.startsWith("devbuild-") || entry.startsWith("exporter-")) {
      if (isSharedDevBuildRootBuckOutEntry(entry) && !broadCleanup) continue;
      if (live.has(entry) && !broadCleanup) continue;
      await $({ stdio: "ignore" })`buck2 --isolation-dir ${entry} kill`.nothrow();
      live.delete(entry);
    }
    if (live.has(entry)) continue;
    await fsp.rm(path.join(buckOut, entry), { recursive: true, force: true }).catch(() => {});
    removed.push(entry);
  }

  const tmp = path.join(buckOut, "tmp");
  const tmpEntries = await fsp.readdir(tmp).catch(() => [] as string[]);
  for (const entry of tmpEntries) {
    const abs = path.join(tmp, entry);
    if (entry.startsWith("dev-build-buck-reaper-")) {
      await fsp.rm(abs, { recursive: true, force: true }).catch(() => {});
      removed.push(`tmp/${entry}`);
      continue;
    }
    if (entry === "shared-isolation-locks") {
      if (!broadCleanup) continue;
      await fsp.rm(abs, { recursive: true, force: true }).catch(() => {});
      removed.push(`tmp/${entry}`);
      continue;
    }
    if (entry === "verify-logs") {
      const logEntries = await fsp.readdir(abs).catch(() => [] as string[]);
      for (const log of logEntries) {
        if (!log.startsWith("dev-build-cleanup-")) continue;
        await fsp.rm(path.join(abs, log), { recursive: true, force: true }).catch(() => {});
        removed.push(`tmp/verify-logs/${log}`);
      }
      await removeIfEmpty(abs);
    }
  }

  await removeIfEmpty(tmp);
  await removeIfEmpty(buckOut);
  return removed;
}
