import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { isPidAlive } from "./buck-orphan-cleanup-lib";
import {
  parseVerifyOwnedState,
  readProcessIdentity,
  type RegisteredVerifyProcess,
} from "./owned-process-state";

type VerifyOwnedProc = {
  pid: number;
  ppid: number;
  pgid: number;
  etime: string;
};

type RegisteredVerifyOwnedProc = VerifyOwnedProc & {
  startSig: string;
  logFile: string;
  stateFile: string;
  target: string;
};

type EnvVerifyProc = VerifyOwnedProc & {
  logFile: string;
  stateFile: string;
  target: string;
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

async function psLinesWithEnv(timeoutMs: number): Promise<string[]> {
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

function parseProcessRows(lines: string[]): Map<number, VerifyOwnedProc> {
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

function parseEnvVerifyProcesses(lines: string[]): EnvVerifyProc[] {
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
    out.push({ pid, ppid, pgid, etime, logFile, stateFile, target });
  }
  return out;
}

function ownerPidFromStateFile(stateFile: string): number | null {
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

function dedupeByProcessGroup<T extends EnvVerifyProc>(procs: T[]): T[] {
  const out = new Map<number, T>();
  for (const proc of procs) {
    const existing = out.get(proc.pgid);
    if (!existing || proc.pid === proc.pgid) out.set(proc.pgid, proc);
  }
  return [...out.values()];
}

async function readRegisteredProcessesFromStateFiles(): Promise<RegisteredVerifyOwnedProc[]> {
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

function mergeWithLiveProcessRows(
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

async function signalVerifyProcessGroup(
  proc: EnvVerifyProc,
  opts: {
    log?: (line: string) => Promise<void>;
    reason: "cleanup" | "orphan cleanup";
  },
): Promise<boolean> {
  try {
    process.kill(-proc.pgid, "SIGTERM");
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (isPidAlive(proc.pid)) {
    try {
      process.kill(-proc.pgid, "SIGKILL");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isPidAlive(proc.pid)) {
    if (opts.log) {
      await opts.log(
        `[verify] env-process ${opts.reason}: killed pid=${proc.pid} pgid=${proc.pgid} etime=${proc.etime} target=${proc.target || "(unknown)"} log=${proc.logFile}`,
      );
    }
    return true;
  }
  return false;
}

export async function cleanupCurrentVerifyEnvProcesses(opts: {
  stateFile: string;
  logFile: string | null;
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const rawStateFile = String(opts.stateFile || "").trim();
  const rawLogFile = opts.logFile ? String(opts.logFile).trim() : "";
  if (!rawStateFile || !rawLogFile) return { scanned: 0, candidates: 0, killed: 0 };
  const stateFile = path.resolve(rawStateFile);
  const logFile = path.resolve(rawLogFile);
  const maxKills = Math.max(0, opts.maxKills ?? 200);
  const lines = await psLinesWithEnv(2500);
  const scanned = dedupeByProcessGroup(parseEnvVerifyProcesses(lines));
  const procs = scanned.filter(
    (proc) => path.resolve(proc.stateFile) === stateFile && path.resolve(proc.logFile) === logFile,
  );
  let killed = 0;
  for (const proc of procs) {
    if (killed >= maxKills) break;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "cleanup" })) killed++;
  }
  return { scanned: scanned.length, candidates: procs.length, killed };
}

async function cleanupOrphanVerifyEnvProcesses(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
  staleGraceSec: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const lines = await psLinesWithEnv(2500);
  const procs = dedupeByProcessGroup(parseEnvVerifyProcesses(lines)).filter((proc) => {
    const ownerPid = ownerPidFromStateFile(proc.stateFile);
    if (!ownerPid || isPidAlive(ownerPid)) return false;
    return true;
  });
  let candidates = 0;
  let killed = 0;
  for (const proc of procs) {
    const orphan = proc.ppid <= 1 || !isPidAlive(proc.ppid);
    if (!orphan) continue;
    if (etimeToSeconds(proc.etime) < opts.staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "orphan cleanup" })) killed++;
  }
  return { scanned: procs.length, candidates, killed };
}

export async function cleanupOrphanVerifyProcesses(opts: {
  log?: (line: string) => Promise<void>;
  maxKills?: number;
}): Promise<{ scanned: number; candidates: number; killed: number }> {
  const maxKills = Math.max(0, opts.maxKills ?? 50);
  const staleGraceRaw = Number.parseInt(
    String(process.env.BNX_VERIFY_PROCESS_ORPHAN_STALE_GRACE_SECS || "120"),
    10,
  );
  const staleGraceSec = Math.max(0, Number.isFinite(staleGraceRaw) ? staleGraceRaw : 120);
  const lines = await psLinesWithEnv(2500);
  const liveRows = parseProcessRows(lines);
  const registered = await readRegisteredProcessesFromStateFiles();
  const procs = mergeWithLiveProcessRows(registered, liveRows);
  const envRes = await cleanupOrphanVerifyEnvProcesses({
    log: opts.log,
    maxKills,
    staleGraceSec,
  }).catch(() => ({ scanned: 0, candidates: 0, killed: 0 }));
  let candidates = 0;
  let killed = 0;
  for (const proc of procs) {
    const orphan = proc.ppid <= 1 || !isPidAlive(proc.ppid);
    if (!orphan) continue;
    if (etimeToSeconds(proc.etime) < staleGraceSec) continue;
    candidates++;
    if (killed >= maxKills) continue;
    const current = await readProcessIdentity(proc.pid).catch(() => null);
    if (!current || current.pgid !== proc.pgid) continue;
    if (current.startSig !== proc.startSig) continue;
    if (await signalVerifyProcessGroup(proc, { log: opts.log, reason: "orphan cleanup" })) {
      killed++;
    }
  }
  return {
    scanned: procs.length + envRes.scanned,
    candidates: candidates + envRes.candidates,
    killed: killed + envRes.killed,
  };
}
