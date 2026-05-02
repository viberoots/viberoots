import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { resolveToolPath } from "../../lib/tool-paths.ts";
import { latestSymlink, lockDir, logsDir } from "./paths.ts";

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
    // If ps is unavailable or errors, treat the PID as not alive to avoid hangs in watch mode.
    return false;
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
    return { pid: lockedPid, logPath: lp, active: true };
  }

  try {
    const lp = await fs.realpath(latestSymlink);
    return { pid: 0, logPath: lp, active: false };
  } catch {}

  const newest = await newestVerifyLog();
  if (newest) return { pid: 0, logPath: newest, active: false };
  return { pid: 0, logPath: null, error: "no verify logs found", active: false };
}

export async function resolvePid(pid: number): Promise<Resolution> {
  const active = await pidAlive(pid);
  const lockedPidRaw = await readText(path.join(lockDir, "pid"));
  const lockedLogRaw = await readText(path.join(lockDir, "log"));
  if (lockedPidRaw && lockedLogRaw && lockedPidRaw === String(pid)) {
    const lp = await fs.realpath(lockedLogRaw).catch(() => lockedLogRaw);
    return { pid, logPath: lp, active };
  }
  const byPid = path.join(logsDir, "by-pid", `${pid}.log`);
  try {
    const lp = await fs.realpath(byPid);
    return { pid, logPath: lp, active };
  } catch {}
  const legacy = path.join(logsDir, `verify-${pid}.log`);
  try {
    const lp = await fs.realpath(legacy);
    return { pid, logPath: lp, active };
  } catch {}
  return { pid, logPath: null, error: `log file not found for pid ${pid}`, active };
}
