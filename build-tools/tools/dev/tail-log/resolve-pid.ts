import fs from "node:fs/promises";
import path from "node:path";

export type PidResolution =
  | { pid: number; logPath: string; active: boolean }
  | { pid: number; logPath: null; error: string; active: boolean };

export async function resolvePidFromRoots(opts: {
  pid: number;
  candidateRoots: () => Promise<string[]>;
  lockPidPaths: (root: string) => string[];
  lockLogPaths: (root: string) => string[];
  logsDirsFor: (root: string) => string[];
  pidAlive: (pid: number) => Promise<boolean>;
  readText: (path: string) => Promise<string>;
}): Promise<PidResolution> {
  const active = await opts.pidAlive(opts.pid);
  for (const root of await opts.candidateRoots()) {
    const pidFiles = opts.lockPidPaths(root);
    const logFiles = opts.lockLogPaths(root);
    for (let i = 0; i < pidFiles.length; i += 1) {
      const lockedPidRaw = await opts.readText(pidFiles[i]!);
      const lockedLogRaw = await opts.readText(logFiles[i]!);
      if (lockedPidRaw && lockedLogRaw && lockedPidRaw === String(opts.pid)) {
        const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
        return { pid: opts.pid, logPath: lp, active };
      }
    }
    for (const dir of opts.logsDirsFor(root)) {
      const byPid = path.join(dir, "by-pid", `${opts.pid}.log`);
      const lp = await fs.realpath(byPid).catch(() => null);
      if (lp) return { pid: opts.pid, logPath: lp, active };
      const legacy = path.join(dir, `verify-${opts.pid}.log`);
      const lp2 = await fs.realpath(legacy).catch(() => null);
      if (lp2) return { pid: opts.pid, logPath: lp2, active };
    }
  }
  return {
    pid: opts.pid,
    logPath: null,
    error: `log file not found for pid ${opts.pid}`,
    active,
  };
}
