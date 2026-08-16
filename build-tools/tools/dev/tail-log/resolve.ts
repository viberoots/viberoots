import fs from "node:fs/promises";
import path from "node:path";
import { processTableLines } from "../../lib/process-inspection";
import { workspaceRoot } from "./paths";
import { pidAlive } from "./process-liveness";
import { bestActiveUnmanagedAgentLog } from "./agent-log";
import { resolvePidFromRoots } from "./resolve-pid";

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
    path.join(root, ".viberoots", "buck", "verify-logs"),
    path.join(root, ".viberoots", "workspace", "buck", "verify-logs"),
    path.join(root, ".viberoots", "workspace", "buck", "test-logs"),
    path.join(root, "buck-out", "tmp", "verify-logs"),
  ];
}
function latestSymlinksFor(root: string): string[] {
  return logsDirsFor(root).map((dir) => path.join(dir, "latest.log"));
}
function unmanagedLogsDirsFor(root: string): string[] {
  return [
    path.join(root, ".viberoots", "buck", "agent-test-logs"),
    path.join(root, ".viberoots", "workspace", "buck", "agent-test-logs"),
    path.join(root, "viberoots", ".viberoots", "workspace", "buck", "agent-test-logs"),
  ];
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

function parseProcessLine(line: string): { pid: number; command: string } | null {
  const match = line.match(/^\s*(\d+)\s+(.*)$/s);
  if (!match) return null;
  const pid = Number(match[1]);
  const command = String(match[2] || "");
  if (!Number.isInteger(pid) || pid <= 1 || !command) return null;
  return { pid, command };
}

function shellUnquote(value: string): string {
  return value.replace(/\\(["\\$`])/g, "$1");
}

function extractLogPath(command: string): string {
  const quoted = command.match(/\blog=(["'])(.*?)\1/s);
  if (quoted?.[2]) return shellUnquote(quoted[2]);
  const bare = command.match(/\blog=([^\s;]+\.log)\b/s);
  return bare?.[1] ? shellUnquote(bare[1]) : "";
}

function isUnmanagedVerifyCommand(command: string, root: string): boolean {
  if (!command.includes(root)) return false;
  if (command.includes("tail-log --status")) return false;
  if (!/\bi\s*&&\s*b\s*&&\s*v\b/.test(command) && !command.includes("viberoots verify")) {
    return false;
  }
  return true;
}

async function bestUnmanagedLiveVerify(
  dependencies: ResolveLatestDependencies = {},
): Promise<{ pid: number; logPath: string } | null> {
  const resolveCandidateRoots = dependencies.candidateRoots ?? candidateRoots;
  const isPidAlive = dependencies.pidAlive ?? pidAlive;
  const roots = await resolveCandidateRoots();
  let best: { pid: number; logPath: string; mtime: number } | null = null;
  const lines = await processTableLines({
    psArgs: ["-A", "-ww", "-o", "pid=,command="],
    timeoutMs: 2000,
    pgrepPattern: "agent-test-logs|viberoots verify|i && b && v",
  });
  for (const line of lines) {
    const parsed = parseProcessLine(line);
    if (!parsed) continue;
    const root = roots.find((candidate) => isUnmanagedVerifyCommand(parsed.command, candidate));
    if (!root) continue;
    const logPath = extractLogPath(parsed.command);
    if (!logPath || !path.isAbsolute(logPath) || !logPath.startsWith(root + path.sep)) continue;
    if (!(await isPidAlive(parsed.pid))) continue;
    const st = await fs.stat(logPath).catch(() => null);
    if (!st?.isFile()) continue;
    if (!best || st.mtimeMs > best.mtime) {
      const lp = await fs.realpath(logPath).catch(() => logPath);
      best = { pid: parsed.pid, logPath: lp, mtime: st.mtimeMs };
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
  const unmanaged = await bestUnmanagedLiveVerify(dependencies);
  if (unmanaged) return { pid: unmanaged.pid, logPath: unmanaged.logPath, active: true };
  const activeAgentLog = await bestActiveUnmanagedAgentLog({
    resolveCandidateRoots,
    logsDirsFor,
    unmanagedLogsDirsFor,
  });
  if (activeAgentLog) {
    return { pid: activeAgentLog.pid, logPath: activeAgentLog.logPath, active: true };
  }

  const sym = await bestLatestSymlink(resolveCandidateRoots);
  if (sym) return { pid: 0, logPath: sym, active: false };

  const newest = await newestVerifyLog(resolveCandidateRoots);
  if (newest) return { pid: 0, logPath: newest, active: false };
  return { pid: 0, logPath: null, error: "no verify logs found", active: false };
}

export async function resolvePid(pid: number): Promise<Resolution> {
  return resolvePidFromRoots({
    pid,
    candidateRoots,
    lockPidPaths,
    lockLogPaths,
    logsDirsFor,
    pidAlive,
    readText,
  });
}
