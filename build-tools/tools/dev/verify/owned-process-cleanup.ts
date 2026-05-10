import * as fsp from "node:fs/promises";
import process from "node:process";
import {
  parseVerifyOwnedState,
  readProcessIdentity,
  type RegisteredVerifyProcess,
} from "./owned-process-state";

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function signalProcessGroup(pgid: number, signal: NodeJS.Signals): Promise<void> {
  if (!Number.isFinite(pgid) || pgid <= 1) return;
  try {
    process.kill(-pgid, signal);
  } catch {}
}

async function signalProcess(
  entry: RegisteredVerifyProcess,
  signal: NodeJS.Signals,
): Promise<void> {
  try {
    process.kill(entry.pid, signal);
  } catch {}
}

export async function cleanupRegisteredVerifyProcesses(opts: {
  stateFile: string;
  logFile?: string;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ processes: number; killed: number }> {
  const stateFile = String(opts.stateFile || "").trim();
  if (!stateFile) return { processes: 0, killed: 0 };
  const txt = await fsp.readFile(stateFile, "utf8").catch(() => "");
  const parsed = parseVerifyOwnedState(txt);
  const unique = new Map<string, RegisteredVerifyProcess>();
  for (const entry of parsed.processes) {
    unique.set(`${entry.pid}:${entry.startSig}`, entry);
  }
  const logFile = String(opts.logFile || "").trim();
  const processes = [...unique.values()].filter((entry) => !logFile || entry.logFile === logFile);
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  let killed = 0;
  for (const entry of processes) {
    if (killed >= maxKills) break;
    if (!pidAlive(entry.pid)) continue;
    const current = await readProcessIdentity(entry.pid, 1500, { allowPidFallback: true });
    if (!current) continue;
    if (current.startSig !== entry.startSig || current.pgid !== entry.pgid) continue;
    await signalProcessGroup(entry.pgid, "SIGTERM");
    if (current.pidFallback) await signalProcess(entry, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (pidAlive(entry.pid)) {
      await signalProcessGroup(entry.pgid, "SIGKILL");
      if (current.pidFallback) await signalProcess(entry, "SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!pidAlive(entry.pid)) {
      killed++;
      if (opts.log) {
        await opts.log(
          `[verify] owned-process cleanup: killed pid=${entry.pid} pgid=${entry.pgid} target=${entry.target || "(unknown)"} log=${entry.logFile}`,
        );
      }
    }
  }
  return { processes: processes.length, killed };
}
