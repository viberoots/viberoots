import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import process from "node:process";
import { resolveToolPathSync } from "../../lib/tool-paths";

const PROCESS_PREFIX = "process\t";
const ISOLATION_PREFIX = "isolation\t";

export type RegisteredVerifyProcess = {
  pid: number;
  pgid: number;
  startSig: string;
  logFile: string;
  target: string;
};

export type RegisteredBuckIsolation = {
  iso: string;
  repoRoot: string;
  ownerPid: number;
  kind: string;
  createdAtMs: number;
};

type ProcessIdentity = {
  pid: number;
  pgid: number;
  startSig: string;
  pidFallback: boolean;
};

type ParsedState = {
  roots: string[];
  processes: RegisteredVerifyProcess[];
  isolations: RegisteredBuckIsolation[];
};

async function psStdout(args: string[], timeoutMs: number): Promise<string> {
  let psPath = "";
  try {
    psPath = resolveToolPathSync("ps");
  } catch {
    return "";
  }
  return await new Promise<string>((resolve) => {
    let child;
    try {
      child = spawn(psPath, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve("");
      return;
    }
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
  opts: { allowPidFallback?: boolean } = {},
): Promise<ProcessIdentity | null> {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  const raw = await psStdout(["-p", String(pid), "-o", "pid=,pgid=,lstart="], timeoutMs);
  const line = String(raw || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return opts.allowPidFallback ? fallbackProcessIdentity(pid) : null;
  const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) return opts.allowPidFallback ? fallbackProcessIdentity(pid) : null;
  const parsedPid = Number(match[1]);
  const pgid = Number(match[2]);
  const startSig = String(match[3] || "").trim();
  if (!Number.isFinite(parsedPid) || parsedPid <= 1) {
    return opts.allowPidFallback ? fallbackProcessIdentity(pid) : null;
  }
  if (!Number.isFinite(pgid) || pgid <= 1) {
    return opts.allowPidFallback ? fallbackProcessIdentity(pid) : null;
  }
  if (!startSig) return opts.allowPidFallback ? fallbackProcessIdentity(pid) : null;
  return { pid: parsedPid, pgid, startSig, pidFallback: false };
}

export function fallbackProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isFinite(pid) || pid <= 1) return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return { pid, pgid: pid, startSig: `pid:${pid}`, pidFallback: true };
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
  const identity = await readProcessIdentity(pid, 1500, { allowPidFallback: true });
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

export async function registerBuckIsolation(opts: {
  stateFile: string;
  iso: string;
  repoRoot: string;
  ownerPid?: number;
  kind: string;
}): Promise<void> {
  const record = buckIsolationRecord(opts);
  if (!record) return;
  await fsp.appendFile(record.stateFile, record.line, "utf8");
}

export function registerBuckIsolationSync(opts: {
  stateFile: string;
  iso: string;
  repoRoot: string;
  ownerPid?: number;
  kind: string;
}): void {
  const record = buckIsolationRecord(opts);
  if (!record) return;
  fs.appendFileSync(record.stateFile, record.line, "utf8");
}

function buckIsolationRecord(opts: {
  stateFile: string;
  iso: string;
  repoRoot: string;
  ownerPid?: number;
  kind: string;
}): { stateFile: string; line: string } | null {
  const stateFile = String(opts.stateFile || "").trim();
  const iso = String(opts.iso || "").trim();
  const repoRoot = String(opts.repoRoot || "").trim();
  if (!stateFile || !iso || !repoRoot) return null;
  const entry: RegisteredBuckIsolation = {
    iso,
    repoRoot,
    ownerPid: Number(opts.ownerPid || process.pid),
    kind: String(opts.kind || "unknown").trim() || "unknown",
    createdAtMs: Date.now(),
  };
  return { stateFile, line: `${ISOLATION_PREFIX}${JSON.stringify(entry)}\n` };
}

export function parseVerifyOwnedState(text: string): ParsedState {
  const roots: string[] = [];
  const processes: RegisteredVerifyProcess[] = [];
  const isolations: RegisteredBuckIsolation[] = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(ISOLATION_PREFIX)) {
      try {
        const parsed = JSON.parse(line.slice(ISOLATION_PREFIX.length)) as RegisteredBuckIsolation;
        if (
          typeof parsed.iso === "string" &&
          parsed.iso.trim() &&
          typeof parsed.repoRoot === "string" &&
          parsed.repoRoot.trim() &&
          Number.isFinite(parsed.ownerPid) &&
          parsed.ownerPid > 1
        ) {
          isolations.push({
            iso: parsed.iso.trim(),
            repoRoot: parsed.repoRoot.trim(),
            ownerPid: parsed.ownerPid,
            kind:
              typeof parsed.kind === "string" && parsed.kind.trim()
                ? parsed.kind.trim()
                : "unknown",
            createdAtMs: Number.isFinite(parsed.createdAtMs) ? parsed.createdAtMs : 0,
          });
        }
      } catch {}
      continue;
    }
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
  return { roots, processes, isolations };
}
