import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { latestSymlink, lockDir, logsDir } from "./paths.ts";

export type Resolution =
  | { pid: number; logPath: string }
  | { pid: number; logPath: null; error: string };

function isInt(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

export async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string): Promise<string> {
  try {
    return String(await fs.readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
}

async function newestVerifyLog(): Promise<string | null> {
  try {
    const entries = await fs.readdir(logsDir);
    const candidates = entries
      .filter((n) => /^verify-.*\.log$/.test(n))
      .map((n) => path.join(logsDir, n));
    let best: { p: string; m: number } | null = null;
    for (const p of candidates) {
      const st = await fs.stat(p).catch(() => null);
      const m = st ? st.mtimeMs : -1;
      if (m > 0 && (!best || m > best.m)) best = { p, m };
    }
    if (!best) return null;
    return await fs.realpath(best.p).catch(() => best.p);
  } catch {
    return null;
  }
}

export async function resolveLatest(): Promise<Resolution> {
  const lockedPidRaw = await readText(path.join(lockDir, "pid"));
  const lockedLogRaw = await readText(path.join(lockDir, "log"));
  const lockedPid = lockedPidRaw && isInt(lockedPidRaw) ? Number(lockedPidRaw) : 0;
  if (lockedPid > 0 && (await pidAlive(lockedPid)) && lockedLogRaw) {
    const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
    return { pid: lockedPid, logPath: lp };
  }

  try {
    const lp = await fs.realpath(latestSymlink);
    return { pid: 0, logPath: lp };
  } catch {}

  const newest = await newestVerifyLog();
  if (newest) return { pid: 0, logPath: newest };
  return { pid: 0, logPath: null, error: "no verify logs found" };
}

export async function resolvePid(pid: number): Promise<Resolution> {
  const lockedPidRaw = await readText(path.join(lockDir, "pid"));
  const lockedLogRaw = await readText(path.join(lockDir, "log"));
  if (lockedPidRaw && lockedLogRaw && lockedPidRaw === String(pid)) {
    const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
    return { pid, logPath: lp };
  }
  const byPid = path.join(logsDir, "by-pid", `${pid}.log`);
  try {
    const lp = await fs.realpath(byPid);
    return { pid, logPath: lp };
  } catch {}
  const legacy = path.join(logsDir, `verify-${pid}.log`);
  try {
    const lp = await fs.realpath(legacy);
    return { pid, logPath: lp };
  } catch {}
  return { pid, logPath: null, error: `log file not found for pid ${pid}` };
}
