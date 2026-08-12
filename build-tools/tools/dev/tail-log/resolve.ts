import fs from "node:fs/promises";
import path from "node:path";
import { workspaceRoot } from "./paths";
import { pidAlive } from "./process-liveness";

export { pidAlive, pidAliveWithSignature, pidStartSignature } from "./process-liveness";

function lockPidPath(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-lock", "pid");
}
function lockLogPath(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-lock", "log");
}
function lockPidPaths(root: string): string[] {
  return [
    path.join(root, ".viberoots", "workspace", "buck", "verify-lock", "pid"),
    lockPidPath(root),
  ];
}
function lockLogPaths(root: string): string[] {
  return [
    path.join(root, ".viberoots", "workspace", "buck", "verify-lock", "log"),
    lockLogPath(root),
  ];
}
function logsDirsFor(root: string): string[] {
  return [
    path.join(root, ".viberoots", "workspace", "buck", "verify-logs"),
    path.join(root, ".viberoots", "workspace", "buck", "test-logs"),
    path.join(root, "buck-out", "tmp", "verify-logs"),
  ];
}
function latestSymlinksFor(root: string): string[] {
  return logsDirsFor(root).map((dir) => path.join(dir, "latest.log"));
}

async function worktreeRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const toolDir of [".claude", ".codex"]) {
    try {
      const wtParent = path.join(workspaceRoot, toolDir, "worktrees");
      const entries = await fs.readdir(wtParent);
      for (const n of entries) roots.push(path.join(wtParent, n));
    } catch {}
  }
  return roots;
}

async function candidateRoots(): Promise<string[]> {
  const roots = new Set<string>([workspaceRoot]);
  for (const r of await worktreeRoots()) roots.add(r);
  return [...roots];
}

export type Resolution =
  | { pid: number; logPath: string; active: boolean }
  | { pid: number; logPath: null; error: string; active: boolean };

export type ResolveLatestDependencies = {
  candidateRoots?: () => Promise<string[]>;
  pidAlive?: (pid: number) => Promise<boolean>;
};

function isInt(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

async function readText(p: string): Promise<string> {
  try {
    return String(await fs.readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
}

async function newestVerifyLog(
  resolveCandidateRoots: () => Promise<string[]> = candidateRoots,
): Promise<string | null> {
  let best: { p: string; m: number } | null = null;
  for (const root of await resolveCandidateRoots()) {
    for (const dir of logsDirsFor(root)) {
      try {
        const entries = await fs.readdir(dir);
        const candidates = entries
          .filter((n) => /^(verify-|pr[0-9].*|.*verify.*).*\.log$/.test(n))
          .map((n) => path.join(dir, n));
        for (const p of candidates) {
          const st = await fs.stat(p).catch(() => null);
          const m = st ? st.mtimeMs : -1;
          if (m > 0 && (!best || m > best.m)) best = { p, m };
        }
      } catch {}
    }
  }
  if (!best) return null;
  return await fs.realpath(best.p).catch(() => best.p);
}

async function bestLiveLock(
  dependencies: ResolveLatestDependencies = {},
): Promise<{ pid: number; logPath: string } | null> {
  const resolveCandidateRoots = dependencies.candidateRoots ?? candidateRoots;
  const isPidAlive = dependencies.pidAlive ?? pidAlive;
  let best: { pid: number; logPath: string; mtime: number } | null = null;
  for (const root of await resolveCandidateRoots()) {
    const pidFiles = lockPidPaths(root);
    const logFiles = lockLogPaths(root);
    for (let i = 0; i < pidFiles.length; i += 1) {
      const pidFile = pidFiles[i]!;
      const logFile = logFiles[i]!;
      const pidRaw = await readText(pidFile);
      const logRaw = await readText(logFile);
      const pid = pidRaw && isInt(pidRaw) ? Number(pidRaw) : 0;
      if (pid <= 0 || !logRaw) continue;
      if (!(await isPidAlive(pid))) continue;
      const st = await fs.stat(pidFile).catch(() => null);
      const m = st ? st.mtimeMs : 0;
      if (!best || m > best.mtime) {
        const lp = await fs.realpath(logRaw).catch(() => logRaw);
        best = { pid, logPath: lp, mtime: m };
      }
    }
  }
  if (!best) return null;
  return { pid: best.pid, logPath: best.logPath };
}

async function bestLatestSymlink(
  resolveCandidateRoots: () => Promise<string[]> = candidateRoots,
): Promise<string | null> {
  let best: { p: string; m: number } | null = null;
  for (const root of await resolveCandidateRoots()) {
    for (const latest of latestSymlinksFor(root)) {
      try {
        const real = await fs.realpath(latest);
        const st = await fs.stat(real);
        if (!best || st.mtimeMs > best.m) best = { p: real, m: st.mtimeMs };
      } catch {}
    }
  }
  return best?.p ?? null;
}

export async function resolveLatest(
  dependencies: ResolveLatestDependencies = {},
): Promise<Resolution> {
  const resolveCandidateRoots = dependencies.candidateRoots ?? candidateRoots;
  const live = await bestLiveLock(dependencies);
  if (live) return { pid: live.pid, logPath: live.logPath, active: true };

  const sym = await bestLatestSymlink(resolveCandidateRoots);
  if (sym) return { pid: 0, logPath: sym, active: false };

  const newest = await newestVerifyLog(resolveCandidateRoots);
  if (newest) return { pid: 0, logPath: newest, active: false };
  return { pid: 0, logPath: null, error: "no verify logs found", active: false };
}

export async function resolvePid(pid: number): Promise<Resolution> {
  const active = await pidAlive(pid);
  for (const root of await candidateRoots()) {
    const pidFiles = lockPidPaths(root);
    const logFiles = lockLogPaths(root);
    for (let i = 0; i < pidFiles.length; i += 1) {
      const lockedPidRaw = await readText(pidFiles[i]!);
      const lockedLogRaw = await readText(logFiles[i]!);
      if (lockedPidRaw && lockedLogRaw && lockedPidRaw === String(pid)) {
        const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
        return { pid, logPath: lp, active };
      }
    }
    for (const dir of logsDirsFor(root)) {
      const byPid = path.join(dir, "by-pid", `${pid}.log`);
      const lp = await fs.realpath(byPid).catch(() => null);
      if (lp) return { pid, logPath: lp, active };
      const legacy = path.join(dir, `verify-${pid}.log`);
      const lp2 = await fs.realpath(legacy).catch(() => null);
      if (lp2) return { pid, logPath: lp2, active };
    }
  }
  return { pid, logPath: null, error: `log file not found for pid ${pid}`, active };
}
