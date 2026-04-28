import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import process from "node:process";
import { resolveToolPathSync } from "../../lib/tool-paths";

const PROCESS_PREFIX = "process\t";

export type RegisteredVerifyProcess = {
  pid: number;
  pgid: number;
  startSig: string;
  logFile: string;
  target: string;
};

type ProcessIdentity = {
  pid: number;
  pgid: number;
  startSig: string;
};

type ParsedState = {
  roots: string[];
  processes: RegisteredVerifyProcess[];
};

async function psStdout(args: string[], timeoutMs: number): Promise<string> {
  const psPath = resolveToolPathSync("ps");
  return await new Promise<string>((resolve) => {
    const child = spawn(psPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(String(buf || "")));
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve(String(buf || ""));
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(timer));
  });
}

export async function readProcessIdentity(
  pid: number,
  timeoutMs: number = 1500,
): Promise<ProcessIdentity | null> {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  const raw = await psStdout(["-p", String(pid), "-o", "pid=,pgid=,lstart="], timeoutMs);
  const line = String(raw || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return null;
  const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) return null;
  const parsedPid = Number(match[1]);
  const pgid = Number(match[2]);
  const startSig = String(match[3] || "").trim();
  if (!Number.isFinite(parsedPid) || parsedPid <= 1) return null;
  if (!Number.isFinite(pgid) || pgid <= 1) return null;
  if (!startSig) return null;
  return { pid: parsedPid, pgid, startSig };
}

export async function registerCurrentVerifyProcess(opts: {
  stateFile: string;
  logFile: string;
  target: string;
  pid?: number;
}): Promise<void> {
  const stateFile = String(opts.stateFile || "").trim();
  const logFile = String(opts.logFile || "").trim();
  if (!stateFile || !logFile) return;
  const target = String(opts.target || "").trim();
  const pid = Number(opts.pid || process.pid);
  const identity = await readProcessIdentity(pid);
  if (!identity) return;
  const entry: RegisteredVerifyProcess = {
    pid: identity.pid,
    pgid: identity.pgid,
    startSig: identity.startSig,
    logFile,
    target,
  };
  await fsp.appendFile(stateFile, `${PROCESS_PREFIX}${JSON.stringify(entry)}\n`, "utf8");
}

export function parseVerifyOwnedState(text: string): ParsedState {
  const roots: string[] = [];
  const processes: RegisteredVerifyProcess[] = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith(PROCESS_PREFIX)) {
      roots.push(line);
      continue;
    }
    try {
      const parsed = JSON.parse(line.slice(PROCESS_PREFIX.length)) as RegisteredVerifyProcess;
      if (
        Number.isFinite(parsed.pid) &&
        parsed.pid > 1 &&
        Number.isFinite(parsed.pgid) &&
        parsed.pgid > 1 &&
        typeof parsed.startSig === "string" &&
        parsed.startSig.trim() &&
        typeof parsed.logFile === "string" &&
        parsed.logFile.trim()
      ) {
        processes.push({
          pid: parsed.pid,
          pgid: parsed.pgid,
          startSig: parsed.startSig.trim(),
          logFile: parsed.logFile.trim(),
          target: typeof parsed.target === "string" ? parsed.target.trim() : "",
        });
      }
    } catch {}
  }
  return { roots, processes };
}

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

export async function cleanupRegisteredVerifyProcesses(opts: {
  stateFile: string;
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
  const processes = [...unique.values()];
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  let killed = 0;
  for (const entry of processes) {
    if (killed >= maxKills) break;
    if (!pidAlive(entry.pid)) continue;
    const current = await readProcessIdentity(entry.pid);
    if (!current) continue;
    if (current.startSig !== entry.startSig || current.pgid !== entry.pgid) continue;
    await signalProcessGroup(entry.pgid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (pidAlive(entry.pid)) {
      await signalProcessGroup(entry.pgid, "SIGKILL");
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
