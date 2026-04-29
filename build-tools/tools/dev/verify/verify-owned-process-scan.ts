import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { isPidAlive } from "./buck-orphan-cleanup-lib";
import { parseVerifyOwnedState } from "./owned-process-state";

export type VerifyOwnedProc = {
  pid: number;
  ppid: number;
  pgid: number;
  etime: string;
};

export type RegisteredVerifyOwnedProc = VerifyOwnedProc & {
  startSig: string;
  logFile: string;
  stateFile: string;
  target: string;
};

export type EnvVerifyProc = VerifyOwnedProc & {
  logFile: string;
  stateFile: string;
  target: string;
  commandSummary: string;
};

export function etimeToSeconds(etime: string): number {
  const raw = String(etime || "").trim();
  if (!raw) return 0;
  const dm = raw.match(/^(\d+)-(.+)$/);
  const days = dm ? Number(dm[1]) : 0;
  const clock = dm ? dm[2] : raw;
  const parts = clock
    .split(":")
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return days * 86400 + h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return days * 86400 + m * 60 + s;
  }
  return days * 86400;
}

export async function psLinesWithEnv(timeoutMs: number): Promise<string[]> {
  const psPath = resolveToolPathSync("ps");
  return await new Promise<string[]>((resolve) => {
    const child = spawn(psPath, ["eww", "-A", "-o", "pid=,ppid=,pgid=,etime=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      resolve(
        String(buf || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        resolve([]);
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(timer));
  });
}

export function parseProcessRows(lines: string[]): Map<number, VerifyOwnedProc> {
  const out = new Map<number, VerifyOwnedProc>();
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    const etime = String(match[4] || "");
    if (!Number.isFinite(pid) || pid <= 1) continue;
    if (!Number.isFinite(ppid) || ppid < 0) continue;
    if (!Number.isFinite(pgid) || pgid <= 1) continue;
    out.set(pid, { pid, ppid, pgid, etime });
  }
  return out;
}

function matchEnvValue(cmd: string, name: string): string {
  const quoted = cmd.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (quoted?.[1]) return quoted[1].trim();
  const bare = cmd.match(new RegExp(`\\b${name}=([^\\s;]+)`));
  return bare?.[1] ? bare[1].trim() : "";
}

function summarizeCommand(cmd: string): string {
  const envMarkers = [
    " BNX_VERIFY_LOG_FILE=",
    " BNX_VERIFY_PROCESS_STATE_FILE=",
    " BNX_BUCK_REAPER_STATE_FILE=",
    " BUCK_TEST_TARGET=",
  ];
  const cut = envMarkers
    .map((marker) => cmd.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const withoutEnv = cut === undefined ? cmd : cmd.slice(0, cut);
  return withoutEnv.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function parseEnvVerifyProcesses(lines: string[]): EnvVerifyProc[] {
  const out: EnvVerifyProc[] = [];
  for (const line of lines) {
    if (!line.includes("BUCK_TEST_TARGET=")) continue;
    if (!line.includes("BNX_VERIFY_LOG_FILE=")) continue;
    if (
      !line.includes("BNX_VERIFY_PROCESS_STATE_FILE=") &&
      !line.includes("BNX_BUCK_REAPER_STATE_FILE=")
    ) {
      continue;
    }
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const pgid = Number(match[3]);
    const etime = String(match[4] || "");
    const cmd = String(match[5] || "");
    if (!Number.isFinite(pid) || pid <= 1 || pid === process.pid) continue;
    if (!Number.isFinite(ppid) || ppid < 0) continue;
    if (!Number.isFinite(pgid) || pgid <= 1 || pgid === process.pid) continue;

    const logFile = matchEnvValue(cmd, "BNX_VERIFY_LOG_FILE");
    const stateFile =
      matchEnvValue(cmd, "BNX_VERIFY_PROCESS_STATE_FILE") ||
      matchEnvValue(cmd, "BNX_BUCK_REAPER_STATE_FILE");
    const target = matchEnvValue(cmd, "BUCK_TEST_TARGET");
    if (!logFile || !stateFile || !target) continue;
    out.push({
      pid,
      ppid,
      pgid,
      etime,
      logFile,
      stateFile,
      target,
      commandSummary: summarizeCommand(cmd),
    });
  }
  return out;
}

export function ownerPidFromStateFile(stateFile: string): number | null {
  const base = path.basename(stateFile);
  const match = base.match(/^bucknix-buck-reaper-v-(\d+)-/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isFinite(pid) && pid > 1 ? pid : null;
}

async function listCandidateStateFiles(): Promise<string[]> {
  const dirs = new Set<string>();
  const tmpDir = String(process.env.TMPDIR || os.tmpdir()).trim();
  if (tmpDir) dirs.add(path.resolve(tmpDir));
  dirs.add(path.resolve(os.tmpdir()));
  const currentStateFile = String(process.env.BNX_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (currentStateFile) dirs.add(path.dirname(path.resolve(currentStateFile)));

  const files: string[] = [];
  for (const dir of dirs) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^bucknix-buck-reaper-v-.*\.txt$/.test(entry.name)) continue;
      const stateFile = path.join(dir, entry.name);
      const ownerPid = ownerPidFromStateFile(stateFile);
      if (ownerPid && isPidAlive(ownerPid)) continue;
      files.push(stateFile);
    }
  }
  return Array.from(new Set(files));
}

export function dedupeByProcessGroup<T extends EnvVerifyProc>(procs: T[]): T[] {
  const out = new Map<number, T>();
  for (const proc of procs) {
    const existing = out.get(proc.pgid);
    if (!existing || proc.pid === proc.pgid) out.set(proc.pgid, proc);
  }
  return [...out.values()];
}

export async function readRegisteredProcessesFromStateFiles(): Promise<
  RegisteredVerifyOwnedProc[]
> {
  const out: RegisteredVerifyOwnedProc[] = [];
  const seen = new Set<string>();
  const stateFiles = await listCandidateStateFiles();
  for (const stateFile of stateFiles) {
    const text = await fsp.readFile(stateFile, "utf8").catch(() => "");
    if (!text.trim()) continue;
    const parsed = parseVerifyOwnedState(text);
    for (const entry of parsed.processes) {
      const key = `${entry.pid}:${entry.pgid}:${entry.startSig}:${entry.logFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...entry, ppid: 0, etime: "", stateFile });
    }
  }
  return out;
}

export function mergeWithLiveProcessRows(
  registered: RegisteredVerifyOwnedProc[],
  liveRows: Map<number, VerifyOwnedProc>,
): RegisteredVerifyOwnedProc[] {
  const out: RegisteredVerifyOwnedProc[] = [];
  for (const entry of registered) {
    const live = liveRows.get(entry.pid);
    if (!live) continue;
    out.push({
      ...live,
      startSig: entry.startSig,
      logFile: entry.logFile,
      target: entry.target,
      stateFile: entry.stateFile,
    });
  }
  return out;
}
