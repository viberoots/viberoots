import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { resolveToolPath } from "../../lib/tool-paths";
import { workspaceRoot } from "./paths";

function lockPidPath(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-lock", "pid");
}
function lockLogPath(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-lock", "log");
}
function logsDirFor(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-logs");
}
function latestSymlinkFor(root: string): string {
  return path.join(logsDirFor(root), "latest.log");
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

function isInt(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

export async function pidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // `kill(pid, 0)` returns success for zombies (the PID exists but has exited).
  // For tail-log's "watch until pid ends" semantics we treat zombies as not alive.
  try {
    const psPath = await resolveToolPath("ps");
    const stat = await new Promise<string>((resolve, reject) => {
      const p = spawn(psPath, ["-p", String(pid), "-o", "stat="], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout?.on("data", (b) => (out += String(b)));
      p.stderr?.on("data", (b) => (err += String(b)));
      p.on("error", reject);
      p.on("exit", (code) => {
        if (code === 0) {
          resolve(out.trim());
          return;
        }
        reject(new Error(`ps exited ${code ?? "null"}: ${err.trim()}`));
      });
    });
    if (!stat) return false;
    // Common formats: "S+", "R+", "Z+", "Z".
    if (stat.includes("Z")) return false;
    return true;
  } catch {
    // If ps is unavailable but kill(0) succeeded, keep the lock live. In sandboxed
    // environments /bin/ps can be denied even for same-user processes.
    return true;
  }
}

export async function pidStartSignature(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  try {
    const psPath = await resolveToolPath("ps");
    const sig = await new Promise<string>((resolve, reject) => {
      const p = spawn(psPath, ["-p", String(pid), "-o", "lstart="], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout?.on("data", (b) => (out += String(b)));
      p.stderr?.on("data", (b) => (err += String(b)));
      p.on("error", reject);
      p.on("exit", (code) => {
        if (code === 0) {
          resolve(out.trim());
          return;
        }
        reject(new Error(`ps exited ${code ?? "null"}: ${err.trim()}`));
      });
    });
    return sig;
  } catch {
    return "";
  }
}

export async function pidAliveWithSignature(pid: number, expectedSig: string): Promise<boolean> {
  if (!(await pidAlive(pid))) return false;
  if (!expectedSig) return true;
  const sig = await pidStartSignature(pid);
  if (!sig) return false;
  return sig === expectedSig;
}
async function readText(p: string): Promise<string> {
  try {
    return String(await fs.readFile(p, "utf8")).trim();
  } catch {
    return "";
  }
}

async function newestVerifyLog(): Promise<string | null> {
  let best: { p: string; m: number } | null = null;
  for (const root of await candidateRoots()) {
    const dir = logsDirFor(root);
    try {
      const entries = await fs.readdir(dir);
      const candidates = entries
        .filter((n) => /^verify-.*\.log$/.test(n))
        .map((n) => path.join(dir, n));
      for (const p of candidates) {
        const st = await fs.stat(p).catch(() => null);
        const m = st ? st.mtimeMs : -1;
        if (m > 0 && (!best || m > best.m)) best = { p, m };
      }
    } catch {}
  }
  if (!best) return null;
  return await fs.realpath(best.p).catch(() => best.p);
}

async function bestLiveLock(): Promise<{ pid: number; logPath: string } | null> {
  let best: { pid: number; logPath: string; mtime: number } | null = null;
  for (const root of await candidateRoots()) {
    const pidFile = lockPidPath(root);
    const logFile = lockLogPath(root);
    const pidRaw = await readText(pidFile);
    const logRaw = await readText(logFile);
    const pid = pidRaw && isInt(pidRaw) ? Number(pidRaw) : 0;
    if (pid <= 0 || !logRaw) continue;
    if (!(await pidAlive(pid))) continue;
    const st = await fs.stat(pidFile).catch(() => null);
    const m = st ? st.mtimeMs : 0;
    if (!best || m > best.mtime) {
      const lp = await fs.realpath(logRaw).catch(() => logRaw);
      best = { pid, logPath: lp, mtime: m };
    }
  }
  if (!best) return null;
  return { pid: best.pid, logPath: best.logPath };
}

async function bestLatestSymlink(): Promise<string | null> {
  let best: { p: string; m: number } | null = null;
  for (const root of await candidateRoots()) {
    try {
      const real = await fs.realpath(latestSymlinkFor(root));
      const st = await fs.stat(real);
      if (!best || st.mtimeMs > best.m) best = { p: real, m: st.mtimeMs };
    } catch {}
  }
  return best?.p ?? null;
}

export async function resolveLatest(): Promise<Resolution> {
  const live = await bestLiveLock();
  if (live) return { pid: live.pid, logPath: live.logPath, active: true };

  const sym = await bestLatestSymlink();
  if (sym) return { pid: 0, logPath: sym, active: false };

  const newest = await newestVerifyLog();
  if (newest) return { pid: 0, logPath: newest, active: false };
  return { pid: 0, logPath: null, error: "no verify logs found", active: false };
}

export async function resolvePid(pid: number): Promise<Resolution> {
  const active = await pidAlive(pid);
  for (const root of await candidateRoots()) {
    const lockedPidRaw = await readText(lockPidPath(root));
    const lockedLogRaw = await readText(lockLogPath(root));
    if (lockedPidRaw && lockedLogRaw && lockedPidRaw === String(pid)) {
      const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
      return { pid, logPath: lp, active };
    }
    const dir = logsDirFor(root);
    const byPid = path.join(dir, "by-pid", `${pid}.log`);
    const lp = await fs.realpath(byPid).catch(() => null);
    if (lp) return { pid, logPath: lp, active };
    const legacy = path.join(dir, `verify-${pid}.log`);
    const lp2 = await fs.realpath(legacy).catch(() => null);
    if (lp2) return { pid, logPath: lp2, active };
  }
  return { pid, logPath: null, error: `log file not found for pid ${pid}`, active };
}
